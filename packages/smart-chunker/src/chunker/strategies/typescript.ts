/**
 * TypeScript / JavaScript semantic chunker.
 *
 * Uses the TypeScript Compiler API (`ts.createSourceFile`) to parse the file
 * into an AST and extract top-level declarations as individual chunks.
 * Each chunk is a self-contained unit (function, class, interface, type alias,
 * enum, or exported variable) with its leading JSDoc/comments attached.
 *
 * Classes exceeding CLASS_SPLIT_THRESHOLD lines are further split into
 * per-method sub-chunks.
 */

import ts from 'typescript';
import type { Chunk } from '../chunk.interface.js';
import { generateChunkId, hashContent } from '../chunk.interface.js';
import type { ScannedFile } from '../../scanner/file-scanner.js';
import type { ChunkerOptions } from '../chunker-registry.js';

/** Classes larger than this (in lines) are split into per-member sub-chunks. */
const CLASS_SPLIT_THRESHOLD = 40;

/** Minimum chunk size in characters — trivially small chunks are merged upward. */
const MIN_CHUNK_SIZE = 50;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function chunkTypeScript(file: ScannedFile, options: ChunkerOptions): Chunk[] {
  const sourceFile = ts.createSourceFile(
    file.relativePath,
    file.content,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    getScriptKind(file.extension),
  );

  const lines = file.content.split('\n');
  const importsBlock = extractImportsBlock(sourceFile, lines);
  const rawChunks = extractTopLevelDeclarations(sourceFile, lines, importsBlock);

  // If the parser found nothing meaningful, fall back to whole-file-as-one-chunk
  if (rawChunks.length === 0) {
    if (file.content.trim().length < MIN_CHUNK_SIZE) return [];
    rawChunks.push({
      content: file.content,
      symbolName: file.relativePath,
      symbolType: 'other' as const,
      lineStart: 1,
      lineEnd: lines.length,
    });
  }

  // Assign chunk indices and build final Chunk objects
  const totalChunks = rawChunks.length;
  return rawChunks.map((raw, i) => ({
    id: generateChunkId(file.relativePath, i, raw.content),
    content: raw.content,
    metadata: {
      filePath: file.relativePath,
      projectName: options.projectName,
      fileType: 'typescript',
      chunkIndex: i,
      totalChunks,
      symbolName: raw.symbolName,
      symbolType: raw.symbolType,
      lineStart: raw.lineStart,
      lineEnd: raw.lineEnd,
      _agentId: options.agentId,
      contentHash: hashContent(raw.content),
    },
  }));
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface RawChunk {
  content: string;
  symbolName: string;
  symbolType: 'function' | 'class' | 'interface' | 'type' | 'enum' | 'variable' | 'other';
  lineStart: number;
  lineEnd: number;
}

/** Map file extensions to TypeScript ScriptKind for correct JSX handling. */
function getScriptKind(ext: string): ts.ScriptKind {
  switch (ext) {
    case '.tsx': return ts.ScriptKind.TSX;
    case '.jsx': return ts.ScriptKind.JSX;
    case '.js':
    case '.mjs':
    case '.cjs':
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

/**
 * Extract the contiguous import block at the top of the file.
 * This block is prepended to the first chunk only, providing context
 * about dependencies without duplicating it across every chunk.
 */
function extractImportsBlock(sourceFile: ts.SourceFile, lines: string[]): string {
  let lastImportLine = -1;

  for (const stmt of sourceFile.statements) {
    if (ts.isImportDeclaration(stmt) || ts.isImportEqualsDeclaration(stmt)) {
      const endLine = sourceFile.getLineAndCharacterOfPosition(stmt.getEnd()).line;
      lastImportLine = Math.max(lastImportLine, endLine);
    }
  }

  if (lastImportLine < 0) return '';
  return lines.slice(0, lastImportLine + 1).join('\n');
}

/**
 * Walk the AST's top-level statements and extract each declaration as a RawChunk.
 * Leading comments and JSDoc are attached to the chunk they precede.
 */
function extractTopLevelDeclarations(
  sourceFile: ts.SourceFile,
  lines: string[],
  importsBlock: string,
): RawChunk[] {
  const chunks: RawChunk[] = [];
  let isFirstNonImport = true;

  for (const stmt of sourceFile.statements) {
    // Skip import statements — they're captured in importsBlock
    if (ts.isImportDeclaration(stmt) || ts.isImportEqualsDeclaration(stmt)) continue;

    const info = classifyStatement(stmt);
    if (!info) continue;

    // Calculate line range including leading comments/JSDoc
    const fullStart = stmt.getFullStart();
    const end = stmt.getEnd();
    const startLine = sourceFile.getLineAndCharacterOfPosition(fullStart).line;
    const endLine = sourceFile.getLineAndCharacterOfPosition(end).line;

    // Extract the full text span (including leading trivia — comments, whitespace)
    let chunkText = lines.slice(startLine, endLine + 1).join('\n').trimEnd();

    // Prepend imports to the first real chunk for context
    if (isFirstNonImport && importsBlock) {
      chunkText = importsBlock + '\n\n' + chunkText;
      isFirstNonImport = false;
    }

    // Large classes get split into per-member sub-chunks
    if (info.symbolType === 'class' && (endLine - startLine + 1) > CLASS_SPLIT_THRESHOLD) {
      const subChunks = splitClass(stmt as ts.ClassDeclaration, sourceFile, lines, info.symbolName);
      if (subChunks.length > 0) {
        chunks.push(...subChunks);
        continue;
      }
    }

    if (chunkText.trim().length < MIN_CHUNK_SIZE) continue;

    chunks.push({
      content: chunkText,
      symbolName: info.symbolName,
      symbolType: info.symbolType,
      lineStart: startLine + 1, // 1-based
      lineEnd: endLine + 1,
    });
  }

  return chunks;
}

/** Classify a top-level statement into a symbol name and type. */
function classifyStatement(
  stmt: ts.Statement,
): { symbolName: string; symbolType: RawChunk['symbolType'] } | null {
  if (ts.isFunctionDeclaration(stmt)) {
    return { symbolName: stmt.name?.getText() ?? '<anonymous>', symbolType: 'function' };
  }
  if (ts.isClassDeclaration(stmt)) {
    return { symbolName: stmt.name?.getText() ?? '<anonymous>', symbolType: 'class' };
  }
  if (ts.isInterfaceDeclaration(stmt)) {
    return { symbolName: stmt.name.getText(), symbolType: 'interface' };
  }
  if (ts.isTypeAliasDeclaration(stmt)) {
    return { symbolName: stmt.name.getText(), symbolType: 'type' };
  }
  if (ts.isEnumDeclaration(stmt)) {
    return { symbolName: stmt.name.getText(), symbolType: 'enum' };
  }
  if (ts.isVariableStatement(stmt)) {
    const decl = stmt.declarationList.declarations[0];
    if (decl && ts.isIdentifier(decl.name)) {
      return { symbolName: decl.name.getText(), symbolType: 'variable' };
    }
    return { symbolName: '<variable>', symbolType: 'variable' };
  }
  if (ts.isExportDeclaration(stmt) || ts.isExportAssignment(stmt)) {
    return { symbolName: '<export>', symbolType: 'other' };
  }
  // Expression statements (e.g. top-level calls) are still relevant
  if (ts.isExpressionStatement(stmt)) {
    return { symbolName: '<expression>', symbolType: 'other' };
  }
  return null;
}

/**
 * Split a large class into sub-chunks: one for the class signature + constructor,
 * and one for each subsequent method/property.
 */
function splitClass(
  node: ts.ClassDeclaration,
  sourceFile: ts.SourceFile,
  lines: string[],
  className: string,
): RawChunk[] {
  const subChunks: RawChunk[] = [];
  const members = node.members;

  // Chunk 0: class signature line + everything before the first member
  const classStart = sourceFile.getLineAndCharacterOfPosition(node.getFullStart()).line;
  const firstMember = members[0];
  if (!firstMember) return []; // empty class — don't split

  for (const member of members) {
    const memberStart = sourceFile.getLineAndCharacterOfPosition(member.getFullStart()).line;
    const memberEnd = sourceFile.getLineAndCharacterOfPosition(member.getEnd()).line;

    const memberName = getMemberName(member);
    const memberText = lines.slice(memberStart, memberEnd + 1).join('\n').trimEnd();

    if (memberText.trim().length < MIN_CHUNK_SIZE) continue;

    // Prepend the class signature line for context
    const classLine = lines[classStart]?.trim() ?? `class ${className}`;
    const contextualizedText = `// [${classLine}]\n${memberText}`;

    subChunks.push({
      content: contextualizedText,
      symbolName: `${className}.${memberName}`,
      symbolType: ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member)
        ? 'function'
        : 'variable',
      lineStart: memberStart + 1,
      lineEnd: memberEnd + 1,
    });
  }

  return subChunks;
}

/** Extract a human-readable name from a class member. */
function getMemberName(member: ts.ClassElement): string {
  if (ts.isConstructorDeclaration(member)) return 'constructor';
  if (member.name && ts.isIdentifier(member.name)) return member.name.getText();
  if (member.name && ts.isComputedPropertyName(member.name)) return '[computed]';
  return '<anonymous>';
}
