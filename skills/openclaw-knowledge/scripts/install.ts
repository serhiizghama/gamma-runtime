#!/usr/bin/env tsx
/**
 * install.ts — Gamma Knowledge Plugin installer.
 *
 * Bundles the plugin with esbuild, deploys the artifact to
 * ~/.openclaw/extensions/gamma-knowledge/, copies the better-sqlite3
 * native addon, and ensures the sqlite-vec loadable extension is present.
 *
 * Migration note: this was previously deployed as a Skill
 * (~/.openclaw/skills/gamma-knowledge). The installer now targets the
 * Plugin directory and cleans up the legacy skill path.
 *
 * Usage:
 *   pnpm --filter @gamma/openclaw-knowledge run install:skill
 *   npx tsx scripts/install.ts
 *   npx tsx scripts/install.ts --build-only   # skip deployment
 */

import { build } from 'esbuild';
import {
  mkdirSync,
  existsSync,
  copyFileSync,
  writeFileSync,
  cpSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  rmSync,
} from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function ok(msg: string): void {
  console.log(`  ${GREEN}✓${RESET} ${msg}`);
}

function warn(msg: string): void {
  console.log(`  ${YELLOW}⚠${RESET} ${msg}`);
}

function fail(msg: string): never {
  console.error(`\n  ${RED}✗ ${msg}${RESET}\n`);
  process.exit(1);
}

function heading(msg: string): void {
  console.log(`\n${BOLD}${CYAN}▸ ${msg}${RESET}`);
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SKILL_ROOT = resolve(__dirname, '..');
const DIST_DIR = resolve(SKILL_ROOT, 'dist');

const OPENCLAW_HOME = process.env['OPENCLAW_HOME'] ?? resolve(homedir(), '.openclaw');
const PLUGIN_TARGET = resolve(OPENCLAW_HOME, 'extensions', 'gamma-knowledge');
const DATA_DIR = resolve(OPENCLAW_HOME, 'data');
const EXT_DIR = resolve(OPENCLAW_HOME, 'extensions');

// Legacy skill path — cleaned up during migration
const LEGACY_SKILL_DIR = resolve(OPENCLAW_HOME, 'skills', 'gamma-knowledge');

const BUILD_ONLY = process.argv.includes('--build-only');

// ---------------------------------------------------------------------------
// Platform → sqlite-vec npm package mapping
// ---------------------------------------------------------------------------

interface PlatformSpec {
  /** npm package name for this platform's sqlite-vec build. */
  npmPackage: string;
  /** Filename of the loadable extension inside the npm package. */
  extensionFile: string;
}

const PLATFORM_MAP: Record<string, PlatformSpec> = {
  'darwin-arm64': {
    npmPackage: 'sqlite-vec-darwin-arm64',
    extensionFile: 'vec0.dylib',
  },
  'darwin-x64': {
    npmPackage: 'sqlite-vec-darwin-x64',
    extensionFile: 'vec0.dylib',
  },
  'linux-x64': {
    npmPackage: 'sqlite-vec-linux-x64',
    extensionFile: 'vec0.so',
  },
  'linux-arm64': {
    npmPackage: 'sqlite-vec-linux-arm64',
    extensionFile: 'vec0.so',
  },
  'win32-x64': {
    npmPackage: 'sqlite-vec-windows-x64',
    extensionFile: 'vec0.dll',
  },
};

// ---------------------------------------------------------------------------
// Step 1 — Bundle with esbuild
// ---------------------------------------------------------------------------

async function bundleSkill(): Promise<string> {
  heading('Step 1: Bundle skill with esbuild');

  const entryPoint = resolve(SKILL_ROOT, 'src', 'index.ts');
  if (!existsSync(entryPoint)) {
    fail(`Entry point not found: ${entryPoint}`);
  }

  const outfile = resolve(DIST_DIR, 'index.js');

  await build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    sourcemap: true,
    external: ['better-sqlite3'],
    logLevel: 'warning',
    banner: {
      js: [
        '// gamma-knowledge — OpenClaw Plugin (bundled)',
        `// Built: ${new Date().toISOString()}`,
      ].join('\n'),
    },
  });

  ok(`Bundled → ${DIM}${outfile}${RESET}`);
  return outfile;
}

// ---------------------------------------------------------------------------
// Step 2 — Ensure target directories + clean up legacy skill
// ---------------------------------------------------------------------------

function ensureDirectories(): void {
  heading('Step 2: Ensure target directories');

  for (const dir of [PLUGIN_TARGET, DATA_DIR, EXT_DIR]) {
    mkdirSync(dir, { recursive: true });
    ok(`${DIM}${dir}${RESET}`);
  }

  // Clean up legacy skill installation (migrated to plugin)
  if (existsSync(LEGACY_SKILL_DIR)) {
    rmSync(LEGACY_SKILL_DIR, { recursive: true, force: true });
    ok(`Removed legacy skill dir → ${DIM}${LEGACY_SKILL_DIR}${RESET}`);
  }
}

// ---------------------------------------------------------------------------
// Step 3 — Copy bundled plugin
// ---------------------------------------------------------------------------

function deployBundle(outfile: string): void {
  heading('Step 3: Deploy bundled plugin');

  copyFileSync(outfile, join(PLUGIN_TARGET, 'index.js'));
  ok('index.js');

  const sourcemap = `${outfile}.map`;
  if (existsSync(sourcemap)) {
    copyFileSync(sourcemap, join(PLUGIN_TARGET, 'index.js.map'));
    ok('index.js.map');
  }
}

// ---------------------------------------------------------------------------
// Step 4 — Generate openclaw.plugin.json manifest
// ---------------------------------------------------------------------------

function writeManifest(): void {
  heading('Step 4: Write openclaw.plugin.json manifest');

  const pkgPath = resolve(SKILL_ROOT, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };

  // OpenClaw plugin manifest — registers the plugin and its entry point.
  // The actual tool registration happens at runtime via api.registerTool()
  // inside the default export of index.js.
  const manifest = {
    id: 'gamma-knowledge',
    name: 'Gamma Knowledge Hub',
    version: pkg.version,
    description:
      'Persistent knowledge store with hybrid vector + full-text search (RRF). ' +
      'Provides the vector_store tool for upsert, search, and delete operations.',
    extensions: ['./index.js'],
  };

  const targetPath = join(PLUGIN_TARGET, 'openclaw.plugin.json');
  writeFileSync(targetPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  ok(`openclaw.plugin.json ${DIM}(v${pkg.version})${RESET}`);

  // Also write a package.json so OpenClaw can discover the plugin
  const pluginPkg = {
    name: 'gamma-knowledge',
    version: pkg.version,
    type: 'module',
    openclaw: {
      extensions: ['./index.js'],
    },
    dependencies: {
      'bindings': '^1.5.0',
    },
  };

  const pkgTarget = join(PLUGIN_TARGET, 'package.json');
  writeFileSync(pkgTarget, JSON.stringify(pluginPkg, null, 2) + '\n', 'utf-8');
  ok(`package.json ${DIM}(v${pkg.version})${RESET}`);
}

// ---------------------------------------------------------------------------
// Step 5 — Deploy better-sqlite3 native addon
// ---------------------------------------------------------------------------

function deployBetterSqlite3(): void {
  heading('Step 5: Deploy better-sqlite3 native addon');

  const require = createRequire(resolve(SKILL_ROOT, 'package.json'));
  let bsqlPath: string;

  try {
    bsqlPath = dirname(require.resolve('better-sqlite3/package.json'));
  } catch {
    fail(
      'better-sqlite3 not found in node_modules. Run "pnpm install" first.',
    );
  }

  const targetModules = join(PLUGIN_TARGET, 'node_modules', 'better-sqlite3');
  cpSync(bsqlPath, targetModules, { recursive: true });

  // Verify the prebuilt binary exists
  const prebuildDir = join(targetModules, 'prebuilds');
  if (existsSync(prebuildDir)) {
    const platforms = readdirSync(prebuildDir);
    ok(`better-sqlite3 copied ${DIM}(prebuilds: ${platforms.join(', ')})${RESET}`);
  } else {
    // Fall back to build/ directory (older better-sqlite3 layout)
    const buildDir = join(targetModules, 'build');
    if (existsSync(buildDir)) {
      ok(`better-sqlite3 copied ${DIM}(compiled build/)${RESET}`);
    } else {
      warn('better-sqlite3 copied but no prebuilt binaries detected — may need "npm rebuild"');
    }
  }
}

// ---------------------------------------------------------------------------
// Step 6 — Deploy sqlite-vec extension
// ---------------------------------------------------------------------------

function deploySqliteVec(): void {
  heading('Step 6: Deploy sqlite-vec extension');

  const platformKey = `${process.platform}-${process.arch}`;
  const spec = PLATFORM_MAP[platformKey];

  if (!spec) {
    fail(
      `Unsupported platform: "${platformKey}". ` +
      `Supported: ${Object.keys(PLATFORM_MAP).join(', ')}.\n` +
      `  Set SQLITE_VEC_PATH to provide a pre-downloaded binary.`,
    );
  }

  const targetPath = join(EXT_DIR, spec.extensionFile);

  // Priority 1: Explicit env var
  const envPath = process.env['SQLITE_VEC_PATH'];
  if (envPath) {
    if (!existsSync(envPath)) {
      fail(`SQLITE_VEC_PATH points to "${envPath}" which does not exist.`);
    }
    copyFileSync(envPath, targetPath);
    ok(`Copied from SQLITE_VEC_PATH → ${DIM}${targetPath}${RESET}`);
    return;
  }

  // Priority 2: Already deployed (skip if present and not stale)
  if (existsSync(targetPath)) {
    ok(`Already present → ${DIM}${targetPath}${RESET}`);
    return;
  }

  // Priority 3: Resolve from node_modules (platform-specific npm package)
  const localRequire = createRequire(resolve(SKILL_ROOT, 'package.json'));
  const sourcePath = resolveSqliteVecBinary(localRequire, spec);

  if (sourcePath) {
    copyFileSync(sourcePath, targetPath);
    ok(`Copied from node_modules → ${DIM}${targetPath}${RESET}`);
    return;
  }

  // Priority 4: Download from GitHub releases
  downloadSqliteVec(spec, targetPath);
}

/**
 * Resolve the sqlite-vec native binary from node_modules.
 * pnpm hoists packages into .pnpm virtual store, so we try multiple strategies:
 *  1. Direct require.resolve of the platform package
 *  2. Resolve via the main sqlite-vec package (which depends on the platform pkg)
 *  3. Scan the pnpm virtual store directly
 *  4. Check monorepo root node_modules
 */
function resolveSqliteVecBinary(
  localRequire: NodeRequire,
  spec: PlatformSpec,
): string | null {
  // Strategy 1: Direct resolve
  try {
    const pkgDir = dirname(localRequire.resolve(`${spec.npmPackage}/package.json`));
    const candidate = join(pkgDir, spec.extensionFile);
    if (existsSync(candidate)) return candidate;
  } catch {
    // Not directly resolvable — try other strategies
  }

  // Strategy 2: Resolve via main sqlite-vec package (pnpm peers)
  try {
    const mainPkgDir = dirname(localRequire.resolve('sqlite-vec/package.json'));
    // In pnpm, the platform dep is a sibling in the same virtual store node_modules
    const candidate = join(mainPkgDir, '..', spec.npmPackage, spec.extensionFile);
    if (existsSync(candidate)) return candidate;
  } catch {
    // sqlite-vec itself not resolvable
  }

  // Strategy 3: Scan pnpm virtual store
  const monoRoot = resolve(SKILL_ROOT, '..', '..');
  const pnpmStore = join(monoRoot, 'node_modules', '.pnpm');
  if (existsSync(pnpmStore)) {
    try {
      const entries = readdirSync(pnpmStore).filter((e) => e.startsWith(spec.npmPackage));
      for (const entry of entries) {
        const candidate = join(
          pnpmStore, entry, 'node_modules', spec.npmPackage, spec.extensionFile,
        );
        if (existsSync(candidate)) return candidate;
      }
    } catch {
      // Scan failed — continue
    }
  }

  // Strategy 4: Check monorepo root node_modules (non-pnpm fallback)
  const fallback = join(monoRoot, 'node_modules', spec.npmPackage, spec.extensionFile);
  if (existsSync(fallback)) return fallback;

  return null;
}

function downloadSqliteVec(spec: PlatformSpec, targetPath: string): void {
  warn(`sqlite-vec not found locally. Attempting download...`);

  // Map platform-specific npm package name to GitHub release asset name
  const GITHUB_PLATFORM_MAP: Record<string, string> = {
    'sqlite-vec-darwin-arm64': 'macos-aarch64',
    'sqlite-vec-darwin-x64': 'macos-x86_64',
    'sqlite-vec-linux-x64': 'linux-x86_64',
    'sqlite-vec-linux-arm64': 'linux-aarch64',
    'sqlite-vec-windows-x64': 'windows-x86_64',
  };

  const ghPlatform = GITHUB_PLATFORM_MAP[spec.npmPackage];
  if (!ghPlatform) {
    fail(
      `Cannot determine GitHub release asset for "${spec.npmPackage}".\n` +
      `  Install it manually: npm install ${spec.npmPackage}\n` +
      `  Or set SQLITE_VEC_PATH to the extension binary.`,
    );
  }

  // We use a known stable version
  const VERSION = '0.1.6';
  const assetName = `sqlite-vec-${VERSION}-loadable-${ghPlatform}.tar.gz`;
  const url = `https://github.com/asg017/sqlite-vec/releases/download/v${VERSION}/${assetName}`;

  // Use curl + tar (available on all target platforms) for download + extract
  // This avoids pulling in Node.js HTTP dependencies
  const tmpDir = join(EXT_DIR, '.tmp-sqlite-vec');
  mkdirSync(tmpDir, { recursive: true });

  try {
    console.log(`    ${DIM}Downloading: ${url}${RESET}`);
    execSync(
      `curl -fsSL "${url}" | tar -xz -C "${tmpDir}"`,
      { stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000 },
    );

    const extractedPath = join(tmpDir, spec.extensionFile);
    if (!existsSync(extractedPath)) {
      // Some archives nest files in a subdirectory — search recursively
      const found = findFileRecursive(tmpDir, spec.extensionFile);
      if (!found) {
        fail(
          `Downloaded archive did not contain "${spec.extensionFile}".\n` +
          `  Install manually: npm install ${spec.npmPackage}\n` +
          `  Or download from: ${url}`,
        );
      }
      copyFileSync(found, targetPath);
    } else {
      copyFileSync(extractedPath, targetPath);
    }

    ok(`Downloaded and deployed → ${DIM}${targetPath}${RESET}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(
      `Failed to download sqlite-vec: ${msg}\n` +
      `  Install manually:\n` +
      `    npm install ${spec.npmPackage}\n` +
      `    # then re-run this installer\n` +
      `  Or download directly from:\n` +
      `    ${url}`,
    );
  } finally {
    // Clean up temp directory
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
}

function findFileRecursive(dir: string, filename: string): string | null {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFileRecursive(fullPath, filename);
      if (found) return found;
    } else if (entry.name === filename) {
      return fullPath;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Step 7 — Verification
// ---------------------------------------------------------------------------

function verify(): void {
  heading('Step 7: Verify installation');

  // Check bundled plugin exists
  const indexJs = join(PLUGIN_TARGET, 'index.js');
  if (!existsSync(indexJs)) fail('index.js missing from target');
  ok('index.js present');

  // Check manifest
  const pluginJson = join(PLUGIN_TARGET, 'openclaw.plugin.json');
  if (!existsSync(pluginJson)) fail('openclaw.plugin.json missing from target');
  const manifest = JSON.parse(readFileSync(pluginJson, 'utf-8'));
  if (manifest.id !== 'gamma-knowledge') fail('openclaw.plugin.json has wrong id');
  ok(`openclaw.plugin.json valid ${DIM}(v${manifest.version})${RESET}`);

  // Check better-sqlite3
  const bsql = join(PLUGIN_TARGET, 'node_modules', 'better-sqlite3', 'package.json');
  if (!existsSync(bsql)) fail('better-sqlite3 not deployed');
  ok('better-sqlite3 addon present');

  // Check sqlite-vec
  const platformKey = `${process.platform}-${process.arch}`;
  const spec = PLATFORM_MAP[platformKey];
  if (spec) {
    const extPath = join(EXT_DIR, spec.extensionFile);
    if (!existsSync(extPath)) {
      warn(`sqlite-vec extension not found at ${extPath} — vector search will be unavailable`);
    } else {
      ok(`sqlite-vec extension present ${DIM}(${spec.extensionFile})${RESET}`);
    }
  }

  // Check data directory is writable
  const testFile = join(DATA_DIR, '.write-test');
  try {
    writeFileSync(testFile, '', 'utf-8');
    unlinkSync(testFile);
    ok('Data directory writable');
  } catch {
    warn('Data directory may not be writable — database creation may fail');
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(
    `\n${BOLD}Gamma Knowledge Plugin — Installer${RESET}` +
    `${DIM}  (${process.platform}-${process.arch})${RESET}\n`,
  );

  // Step 1: Bundle
  const outfile = await bundleSkill();

  if (BUILD_ONLY) {
    console.log(`\n${GREEN}${BOLD}Build complete.${RESET} ${DIM}(--build-only, skipping deployment)${RESET}\n`);
    return;
  }

  // Step 2: Directories
  ensureDirectories();

  // Step 3: Deploy bundle
  deployBundle(outfile);

  // Step 4: Manifest
  writeManifest();

  // Step 5: better-sqlite3
  deployBetterSqlite3();

  // Step 6: sqlite-vec
  deploySqliteVec();

  // Step 7: Verify
  verify();

  // Summary
  console.log(`\n${GREEN}${BOLD}Installation complete.${RESET}\n`);
  console.log(`  Plugin:     ${DIM}${PLUGIN_TARGET}${RESET}`);
  console.log(`  Database:   ${DIM}${DATA_DIR}/knowledge.db  (created on first use)${RESET}`);
  console.log(`  Extensions: ${DIM}${EXT_DIR}${RESET}`);
  console.log('');
  console.log(`  ${YELLOW}Next steps:${RESET}`);
  console.log(`    1. Add to plugins.allow: ${DIM}["gamma-knowledge"]${RESET}`);
  console.log(`    2. Add to plugins.entries: ${DIM}{ "gamma-knowledge": { "enabled": true } }${RESET}`);
  console.log(`    3. Remove from skills.entries: ${DIM}gamma-knowledge${RESET}`);
  console.log(`    4. Restart OpenClaw Gateway`);
  console.log('');
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  fail(`Unhandled error: ${msg}`);
});
