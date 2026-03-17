/**
 * Dotfile / config single-chunk strategy.
 *
 * Small config files (.gitignore, .eslintrc, Dockerfile, etc.) are typically
 * under 2 KB and are most useful as a single unit. This strategy emits the
 * entire file as one chunk.
 *
 * For Dockerfiles with multi-stage builds, each `FROM` stage is split into
 * its own chunk to preserve semantic boundaries.
 */

import type { Chunk } from '../chunk.interface.js';
import { generateChunkId, hashContent } from '../chunk.interface.js';
import type { ScannedFile } from '../../scanner/file-scanner.js';
import type { ChunkerOptions } from '../chunker-registry.js';

/** Files under this size are always emitted as a single chunk. */
const SINGLE_CHUNK_THRESHOLD = 2000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function chunkDotfile(file: ScannedFile, options: ChunkerOptions): Chunk[] {
  const content = file.content.trim();
  if (content.length === 0) return [];

  const isDockerfile = file.relativePath.toLowerCase().includes('dockerfile');

  // Multi-stage Dockerfiles get per-stage chunking
  if (isDockerfile && content.length > SINGLE_CHUNK_THRESHOLD) {
    const stages = splitDockerfileStages(file);
    if (stages.length > 1) {
      const totalChunks = stages.length;
      return stages.map((stage, i) => ({
        id: generateChunkId(file.relativePath, i, stage.content),
        content: stage.content,
        metadata: {
          filePath: file.relativePath,
          projectName: options.projectName,
          fileType: 'dockerfile',
          chunkIndex: i,
          totalChunks,
          symbolName: stage.stageName,
          lineStart: stage.lineStart,
          lineEnd: stage.lineEnd,
          _agentId: options.agentId,
          contentHash: hashContent(stage.content),
        },
      }));
    }
  }

  // Default: single chunk for the whole file
  const fileType = inferDotfileType(file);
  const lines = file.content.split('\n');

  return [{
    id: generateChunkId(file.relativePath, 0, content),
    content,
    metadata: {
      filePath: file.relativePath,
      projectName: options.projectName,
      fileType,
      chunkIndex: 0,
      totalChunks: 1,
      lineStart: 1,
      lineEnd: lines.length,
      _agentId: options.agentId,
      contentHash: hashContent(content),
    },
  }];
}

// ---------------------------------------------------------------------------
// Dockerfile stage splitting
// ---------------------------------------------------------------------------

interface DockerStage {
  stageName: string;
  content: string;
  lineStart: number;
  lineEnd: number;
}

function splitDockerfileStages(file: ScannedFile): DockerStage[] {
  const lines = file.content.split('\n');
  const stages: DockerStage[] = [];
  let current: { name: string; startLine: number; lines: string[] } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fromMatch = line.match(/^FROM\s+(\S+)(?:\s+[Aa][Ss]\s+(\S+))?/i);

    if (fromMatch) {
      if (current) {
        stages.push({
          stageName: current.name,
          content: current.lines.join('\n').trimEnd(),
          lineStart: current.startLine,
          lineEnd: i,
        });
      }
      const stageName = fromMatch[2] ?? fromMatch[1];
      current = { name: stageName, startLine: i + 1, lines: [line] };
    } else {
      current?.lines.push(line);
    }
  }

  if (current) {
    stages.push({
      stageName: current.name,
      content: current.lines.join('\n').trimEnd(),
      lineStart: current.startLine,
      lineEnd: lines.length,
    });
  }

  return stages;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inferDotfileType(file: ScannedFile): string {
  const name = file.relativePath.toLowerCase();
  if (name.includes('dockerfile')) return 'dockerfile';
  if (name.endsWith('.gitignore') || name.endsWith('.dockerignore')) return 'ignore';
  if (name.endsWith('.editorconfig')) return 'editorconfig';
  if (name.endsWith('.eslintrc') || name.includes('eslint')) return 'eslint-config';
  if (name.endsWith('.prettierrc') || name.includes('prettier')) return 'prettier-config';
  if (name.endsWith('.env') || name.includes('.env.')) return 'env';
  return 'config';
}
