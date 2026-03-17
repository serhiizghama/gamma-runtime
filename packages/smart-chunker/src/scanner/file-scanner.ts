/**
 * Recursive directory traversal with built-in ignore rules.
 *
 * Walks a target directory depth-first, skipping ignored directories,
 * binary extensions, and oversized files. Returns an array of ScannedFile
 * objects ready for the chunking pipeline.
 */

import { readdir, stat, readFile } from 'node:fs/promises';
import { join, extname, relative, basename } from 'node:path';
import {
  IGNORED_DIRS,
  IGNORED_EXTENSIONS,
  IGNORED_FILES,
  MAX_FILE_SIZE,
} from './ignore-rules.js';

/** A file that has been scanned and read from disk, ready for chunking. */
export interface ScannedFile {
  /** Absolute path on disk. */
  absolutePath: string;
  /** Path relative to the scan root (used in chunk metadata). */
  relativePath: string;
  /** File extension including the dot, e.g. '.ts'. */
  extension: string;
  /** Raw UTF-8 content of the file. */
  content: string;
}

export interface ScanOptions {
  /** Extra glob-like directory or file names to ignore. */
  extraIgnore?: string[];
}

/**
 * Recursively scan a directory and return all eligible text files.
 *
 * @param rootDir  - Absolute path to the directory to scan.
 * @param options  - Optional extra ignore patterns.
 * @returns Array of scanned files with their content.
 */
export async function scanDirectory(
  rootDir: string,
  options: ScanOptions = {},
): Promise<ScannedFile[]> {
  const extraIgnoreDirs = new Set(options.extraIgnore ?? []);
  const results: ScannedFile[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // Permission denied or deleted mid-scan — skip silently
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || extraIgnoreDirs.has(entry.name)) {
          continue;
        }
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;

      // Skip by exact file name
      if (IGNORED_FILES.has(entry.name)) continue;

      // Skip by extension (check both single and compound extensions like .min.js)
      const ext = extname(entry.name).toLowerCase();
      if (IGNORED_EXTENSIONS.has(ext)) continue;

      // Handle compound extensions: .min.js, .min.css, .d.ts maps etc.
      const compoundExt = getCompoundExtension(entry.name);
      if (compoundExt && IGNORED_EXTENSIONS.has(compoundExt)) continue;

      // Skip oversized files
      try {
        const info = await stat(fullPath);
        if (info.size > MAX_FILE_SIZE || info.size === 0) continue;
      } catch {
        continue;
      }

      // Read and verify it's valid UTF-8 text
      try {
        const content = await readFile(fullPath, 'utf-8');

        // Quick binary detection: if the first 512 bytes contain a NUL, skip
        if (content.length > 0 && content.slice(0, 512).includes('\0')) continue;

        results.push({
          absolutePath: fullPath,
          relativePath: relative(rootDir, fullPath),
          extension: ext,
          content,
        });
      } catch {
        // Encoding error or read failure — skip
        continue;
      }
    }
  }

  await walk(rootDir);
  return results;
}

/**
 * Extract compound extension like '.min.js' or '.d.ts' from a filename.
 * Returns null if the file has only a simple extension.
 */
function getCompoundExtension(filename: string): string | null {
  const base = basename(filename);
  const parts = base.split('.');
  if (parts.length >= 3) {
    return '.' + parts.slice(-2).join('.');
  }
  return null;
}
