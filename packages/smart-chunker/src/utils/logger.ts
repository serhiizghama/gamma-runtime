/**
 * Structured logger for the ingestion pipeline.
 *
 * Provides levelled logging with timestamps, progress bars, and colored
 * output. Uses only Node built-ins — no pino dependency to keep the
 * package lean. Output goes to stderr so stdout remains clean for
 * structured data (JSON chunks, etc.).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_LABEL: Record<LogLevel, string> = {
  debug: 'DBG',
  info: 'INF',
  warn: 'WRN',
  error: 'ERR',
};

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

export class Logger {
  private minLevel: number;

  constructor(level: LogLevel = 'info') {
    this.minLevel = LEVEL_PRIORITY[level];
  }

  debug(msg: string, data?: Record<string, unknown>): void {
    this.log('debug', msg, data);
  }

  info(msg: string, data?: Record<string, unknown>): void {
    this.log('info', msg, data);
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    this.log('warn', msg, data);
  }

  error(msg: string, data?: Record<string, unknown>): void {
    this.log('error', msg, data);
  }

  /**
   * Print a progress update on a single overwritten line.
   * Falls back to a standard log line when stderr is not a TTY.
   */
  progress(current: number, total: number, label: string): void {
    if (this.minLevel > LEVEL_PRIORITY.info) return;

    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    const bar = renderBar(pct, 20);
    const line = `  ${bar} ${pct}% (${current}/${total}) ${label}`;

    if (process.stderr.isTTY) {
      process.stderr.write(`\r${line}`);
      if (current >= total) process.stderr.write('\n');
    } else {
      // Non-TTY: only emit at 0%, 25%, 50%, 75%, 100% to avoid noise
      if (current === 1 || current === total || pct % 25 === 0) {
        process.stderr.write(`${line}\n`);
      }
    }
  }

  /** Clear the current progress line (TTY only). */
  clearProgress(): void {
    if (process.stderr.isTTY) {
      process.stderr.write('\r\x1b[K');
    }
  }

  private log(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
    if (LEVEL_PRIORITY[level] < this.minLevel) return;

    const ts = new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
    const label = LEVEL_LABEL[level];
    const suffix = data ? ` ${JSON.stringify(data)}` : '';
    process.stderr.write(`${ts} [${label}] ${msg}${suffix}\n`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Render a simple ASCII progress bar: [████░░░░░░] */
function renderBar(percent: number, width: number): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}
