/**
 * Default ignore patterns for the file scanner.
 *
 * These patterns are matched against directory names (for directory skipping)
 * and file paths (for file filtering). They prevent scanning of build artifacts,
 * binaries, lock files, and other non-semantic content.
 */

/** Directories skipped entirely during traversal (matched by name). */
export const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.output',
  'coverage',
  '.pnpm-store',
  '.cache',
  '.turbo',
  '__pycache__',
  '.venv',
  'vendor',
  '.terraform',
]);

/** File extensions that are always skipped (binary, media, compiled). */
export const IGNORED_EXTENSIONS = new Set([
  // Images
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.bmp', '.tiff',
  // Fonts
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  // Audio/Video
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv', '.flac', '.ogg',
  // Archives
  '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2', '.xz',
  // Databases
  '.db', '.sqlite', '.sqlite3',
  // Minified / source maps
  '.min.js', '.min.css', '.map',
  // Certificates / keys
  '.cert', '.pem', '.key', '.p12', '.pfx',
  // Compiled / native
  '.so', '.dylib', '.dll', '.o', '.obj', '.exe', '.wasm',
  // Images (design)
  '.psd', '.ai', '.sketch', '.fig',
]);

/** Exact file names to skip. */
export const IGNORED_FILES = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lockb',
  '.DS_Store',
  'Thumbs.db',
]);

/** Maximum file size in bytes (1 MB). Files larger than this are skipped. */
export const MAX_FILE_SIZE = 1_048_576;
