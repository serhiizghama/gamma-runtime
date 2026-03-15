import { spawn, ChildProcess } from 'child_process';
import type { Logger } from 'pino';

/** Services the watchdog can supervise. */
export type ManagedService = 'gamma-core' | 'gamma-proxy';

interface ServiceConfig {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

interface ServiceState {
  process: ChildProcess | null;
  pid: number | null;
  crashTimestamps: number[];
  restartCount: number;
  frozen: boolean;
}

const CIRCUIT_BREAKER_WINDOW_MS = 60_000;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const RESTART_BACKOFF_BASE_MS = 1_000;
const RESTART_BACKOFF_MAX_MS = 15_000;

/**
 * Process Manager — supervised child process lifecycle (Steps 5-6).
 *
 * Spawns gamma-core and gamma-proxy as supervised children.
 * Detects fatal exits, restarts with exponential backoff, and enters
 * circuit breaker mode after 3 crashes within 60 seconds.
 */
export class ProcessManager {
  private services = new Map<ManagedService, ServiceState>();
  private configs = new Map<ManagedService, ServiceConfig>();
  private stopped = false;

  constructor(
    private readonly logger: Logger,
  ) {}

  /**
   * Register a service for supervision. Does not start it yet.
   */
  register(name: ManagedService, config: ServiceConfig): void {
    this.configs.set(name, config);
    this.services.set(name, {
      process: null,
      pid: null,
      crashTimestamps: [],
      restartCount: 0,
      frozen: false,
    });
    this.logger.info({ service: name, command: config.command }, '[PM] Service registered');
  }

  /**
   * Start all registered services.
   */
  startAll(): void {
    for (const name of this.configs.keys()) {
      this.spawnService(name);
    }
  }

  /**
   * Get the PID of a managed service, or null if not running.
   */
  getPid(name: ManagedService): number | null {
    return this.services.get(name)?.pid ?? null;
  }

  /**
   * Check if a service's circuit breaker is tripped.
   */
  isCircuitBroken(name: ManagedService): boolean {
    return this.services.get(name)?.frozen ?? false;
  }

  /**
   * Kill a specific service's entire process tree.
   * Used during SESSION_ABORT to guarantee no zombie processes.
   */
  async killService(name: ManagedService): Promise<void> {
    const state = this.services.get(name);
    if (!state?.process || !state.pid) {
      this.logger.debug({ service: name }, '[PM] No running process to kill');
      return;
    }

    this.logger.warn({ service: name, pid: state.pid }, '[PM] Killing process tree');

    try {
      // Kill the entire process group (negative PID = process group)
      process.kill(-state.pid, 'SIGTERM');
    } catch {
      // Process may already be dead — try direct kill
      try {
        state.process.kill('SIGKILL');
      } catch {
        // Already dead
      }
    }

    state.process = null;
    state.pid = null;
  }

  /**
   * Gracefully stop all managed services.
   */
  async stopAll(): Promise<void> {
    this.stopped = true;
    const promises: Promise<void>[] = [];
    for (const name of this.services.keys()) {
      promises.push(this.killService(name));
    }
    await Promise.all(promises);
    this.logger.info('[PM] All services stopped');
  }

  /**
   * Reset the circuit breaker for a service, allowing restarts again.
   */
  resetCircuitBreaker(name: ManagedService): void {
    const state = this.services.get(name);
    if (state) {
      state.frozen = false;
      state.crashTimestamps = [];
      state.restartCount = 0;
      this.logger.info({ service: name }, '[PM] Circuit breaker reset');
    }
  }

  // ── Private ─────────────────────────────────────────────────────────

  private spawnService(name: ManagedService): void {
    if (this.stopped) return;

    const config = this.configs.get(name);
    const state = this.services.get(name);
    if (!config || !state) return;

    if (state.frozen) {
      this.logger.error(
        { service: name },
        '[PM] Circuit breaker OPEN — manual intervention required',
      );
      return;
    }

    this.logger.info(
      { service: name, command: config.command, args: config.args },
      '[PM] Spawning service',
    );

    const child = spawn(config.command, config.args, {
      cwd: config.cwd,
      env: { ...process.env, ...config.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      // detached: true to create a process group (enables tree kill via -pid)
      detached: true,
    });

    state.process = child;
    state.pid = child.pid ?? null;

    this.logger.info({ service: name, pid: child.pid }, '[PM] Service started');

    // Pipe stdout/stderr through watchdog logger
    child.stdout?.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trimEnd();
      if (line) this.logger.info({ service: name, stream: 'stdout' }, line);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trimEnd();
      if (line) this.logger.warn({ service: name, stream: 'stderr' }, line);
    });

    // Handle process exit
    child.on('exit', (exitCode, signal) => {
      state.process = null;
      state.pid = null;

      if (this.stopped) {
        this.logger.info({ service: name, exitCode, signal }, '[PM] Service exited (shutdown)');
        return;
      }

      this.logger.error(
        { service: name, exitCode, signal },
        `[PM] Service crashed — exit=${exitCode} signal=${signal}`,
      );

      this.handleCrash(name, exitCode, signal);
    });

    child.on('error', (err) => {
      this.logger.error(
        { service: name, err: err.message },
        '[PM] Failed to spawn service',
      );
      state.process = null;
      state.pid = null;
    });
  }

  private handleCrash(
    name: ManagedService,
    exitCode: number | null,
    signal: string | null,
  ): void {
    const state = this.services.get(name);
    if (!state) return;

    const now = Date.now();

    // Track crash timestamps for circuit breaker
    state.crashTimestamps.push(now);
    // Evict old timestamps outside the window
    state.crashTimestamps = state.crashTimestamps.filter(
      (ts) => now - ts < CIRCUIT_BREAKER_WINDOW_MS,
    );

    // Check circuit breaker
    if (state.crashTimestamps.length >= CIRCUIT_BREAKER_THRESHOLD) {
      state.frozen = true;
      this.logger.error(
        { service: name, crashes: state.crashTimestamps.length, windowMs: CIRCUIT_BREAKER_WINDOW_MS },
        `[PM] CIRCUIT BREAKER: ${name} crashed ${CIRCUIT_BREAKER_THRESHOLD} times in ${CIRCUIT_BREAKER_WINDOW_MS / 1000}s — halting restarts`,
      );
      return;
    }

    // Exponential backoff restart
    state.restartCount++;
    const delay = Math.min(
      RESTART_BACKOFF_BASE_MS * Math.pow(2, state.restartCount - 1),
      RESTART_BACKOFF_MAX_MS,
    );

    this.logger.warn(
      { service: name, attempt: state.restartCount, delayMs: delay, exitCode, signal },
      `[PM] Scheduling restart in ${delay}ms`,
    );

    setTimeout(() => {
      if (!this.stopped && !state.frozen) {
        this.spawnService(name);
      }
    }, delay);
  }
}
