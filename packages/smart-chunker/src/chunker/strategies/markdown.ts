/**
 * Markdown semantic chunker.
 *
 * Splits Markdown files by headings (`#`, `##`, `###`, etc.). Each heading
 * starts a new chunk that includes all content until the next heading of
 * equal or higher level. A breadcrumb context line is prepended showing the
 * parent heading hierarchy, so every chunk is self-contained.
 *
 * Code fences are never split mid-fence.
 */

import type { Chunk } from '../chunk.interface.js';
import { generateChunkId, hashContent } from '../chunk.interface.js';
import type { ScannedFile } from '../../scanner/file-scanner.js';
import type { ChunkerOptions } from '../chunker-registry.js';

/** Minimum chunk size in characters — trivially small sections are merged upward. */
const MIN_CHUNK_SIZE = 50;

/** Regex that matches a Markdown heading line: captures level (# count) and text. */
const HEADING_RE = /^(#{1,6})\s+(.+)$/;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function chunkMarkdown(file: ScannedFile, options: ChunkerOptions): Chunk[] {
  const lines = file.content.split('\n');
  const sections = splitByHeadings(lines);

  if (sections.length === 0) return [];

  // Merge trivially small sections into the previous section
  const merged = mergeTinySections(sections);

  const totalChunks = merged.length;
  return merged.map((section, i) => {
    const content = buildChunkContent(section);
    return {
      id: generateChunkId(file.relativePath, i, content),
      content,
      metadata: {
        filePath: file.relativePath,
        projectName: options.projectName,
        fileType: 'markdown',
        chunkIndex: i,
        totalChunks,
        headingPath: section.breadcrumb,
        lineStart: section.lineStart,
        lineEnd: section.lineEnd,
        _agentId: options.agentId,
        contentHash: hashContent(content),
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface Section {
  /** Heading level (1–6). 0 for the preamble before any heading. */
  level: number;
  /** The heading text itself (without the `#` prefix). Empty for preamble. */
  heading: string;
  /** Breadcrumb path showing parent headings (e.g. 'Guide > Installation'). */
  breadcrumb: string;
  /** Body lines (including the heading line itself). */
  lines: string[];
  /** 1-based start line in the source file. */
  lineStart: number;
  /** 1-based end line in the source file (inclusive). */
  lineEnd: number;
}

/**
 * Walk through lines and split them into sections based on Markdown headings.
 * Maintains a heading stack to compute breadcrumb paths.
 */
function splitByHeadings(lines: string[]): Section[] {
  const sections: Section[] = [];
  /** Stack of (level, heading) pairs for building breadcrumbs. */
  const headingStack: { level: number; text: string }[] = [];
  let current: Section | null = null;
  let inCodeFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track code fence state so we don't split on `# heading` inside fences
    if (line.trimStart().startsWith('```')) {
      inCodeFence = !inCodeFence;
    }

    if (inCodeFence) {
      current?.lines.push(line);
      continue;
    }

    const match = line.match(HEADING_RE);

    if (match) {
      // Finalize current section
      if (current) {
        current.lineEnd = i; // 1-based: i because we haven't incremented yet
        sections.push(current);
      }

      const level = match[1].length;
      const headingText = match[2].trim();

      // Update heading stack: pop all headings at equal or deeper level
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, text: headingText });

      // Build breadcrumb from the full stack
      const breadcrumb = headingStack.map((h) => h.text).join(' > ');

      current = {
        level,
        heading: headingText,
        breadcrumb,
        lines: [line],
        lineStart: i + 1, // 1-based
        lineEnd: i + 1,
      };
    } else {
      // Content line — start a preamble section if no heading seen yet
      if (!current) {
        current = {
          level: 0,
          heading: '',
          breadcrumb: '',
          lines: [],
          lineStart: i + 1,
          lineEnd: i + 1,
        };
      }
      current.lines.push(line);
    }
  }

  // Push the final section
  if (current) {
    current.lineEnd = lines.length;
    sections.push(current);
  }

  return sections;
}

/**
 * Merge sections whose body content is smaller than MIN_CHUNK_SIZE
 * into the preceding section to avoid noise from trivially small chunks.
 */
function mergeTinySections(sections: Section[]): Section[] {
  if (sections.length <= 1) return sections;

  const result: Section[] = [sections[0]];

  for (let i = 1; i < sections.length; i++) {
    const section = sections[i];
    const bodyText = section.lines.join('\n').trim();

    if (bodyText.length < MIN_CHUNK_SIZE) {
      // Merge into the previous section
      const prev = result[result.length - 1];
      prev.lines.push('', ...section.lines); // blank line separator
      prev.lineEnd = section.lineEnd;
    } else {
      result.push(section);
    }
  }

  return result;
}

/**
 * Build the final chunk content string for a section.
 * Prepends a breadcrumb context line for non-root sections so the chunk
 * is self-contained even when read out of context.
 */
function buildChunkContent(section: Section): string {
  const body = section.lines.join('\n').trimEnd();

  // For the preamble or top-level heading (level ≤ 1), no breadcrumb needed
  if (section.level <= 1 || !section.breadcrumb) {
    return body;
  }

  // Build breadcrumb from the parent path (everything except the last element)
  const parts = section.breadcrumb.split(' > ');
  if (parts.length <= 1) return body;

  const parentPath = parts.slice(0, -1).join(' > ');
  return `[Context: ${parentPath}]\n${body}`;
}
