import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ChildProcess } from 'child_process';
import { ClaudeCliAdapter } from './claude-cli.adapter';

@Injectable()
export class SessionPoolService implements OnApplicationShutdown {
  private readonly logger = new Logger(SessionPoolService.name);
  private running = 0;
  private queue: Array<{ resolve: () => void }> = [];
  private processes: Map<string, ChildProcess> = new Map();
  private readonly maxConcurrent: number;
  private _aborting = false;
  private _killedAgents = new Set<string>();

  constructor(private readonly cliAdapter: ClaudeCliAdapter) {
    this.maxConcurrent = parseInt(process.env.MAX_CONCURRENT_AGENTS ?? '2', 10);
    this.logger.log(`Session pool initialized: maxConcurrent=${this.maxConcurrent}`);
  }

  /** True while an emergency stop is in progress */
  get aborting(): boolean {
    return this._aborting;
  }

  async acquire(): Promise<void> {
    if (this.running < this.maxConcurrent) {
      this.running++;
      return;
    }

    // Wait in queue
    return new Promise<void>((resolve) => {
      this.queue.push({ resolve });
      this.logger.log(`Agent queued. Running: ${this.running}, Queued: ${this.queue.length}`);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      // Don't decrement — next agent takes the slot
      next.resolve();
      this.logger.log(`Dequeued agent. Running: ${this.running}, Queued: ${this.queue.length}`);
    } else {
      this.running--;
    }
  }

  register(agentId: string, proc: ChildProcess): void {
    this.processes.set(agentId, proc);
    this.logger.debug(`Registered process for agent ${agentId} (pid: ${proc.pid})`);
  }

  unregister(agentId: string): void {
    this.processes.delete(agentId);
  }

  isRunning(agentId: string): boolean {
    return this.processes.has(agentId);
  }

  getProcess(agentId: string): ChildProcess | undefined {
    return this.processes.get(agentId);
  }

  /** Check if a specific agent was killed by emergency stop */
  wasKilled(agentId: string): boolean {
    return this._killedAgents.has(agentId);
  }

  /** Clear killed flag for an agent (after orchestrator handled it) */
  clearKilled(agentId: string): void {
    this._killedAgents.delete(agentId);
  }

  get stats(): { running: number; queued: number; maxConcurrent: number } {
    return {
      running: this.running,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
    };
  }

  /** Returns IDs of all agents that were running at abort time */
  async abortAll(): Promise<string[]> {
    this._aborting = true;
    const agentIds = Array.from(this.processes.keys());
    if (agentIds.length === 0) {
      this._aborting = false;
      return [];
    }

    this.logger.warn(`Aborting ${agentIds.length} running agent(s)`);

    // Remember which agents were killed (survives after _aborting resets)
    for (const id of agentIds) {
      this._killedAgents.add(id);
    }

    // SIGTERM all process groups
    for (const [agentId, proc] of this.processes) {
      this.logger.warn(`Killing agent ${agentId} (pid: ${proc.pid})`);
      this.cliAdapter.killProcessGroup(proc);
    }

    // Wait up to 5s for graceful exit
    const deadline = Date.now() + 5000;
    while (this.processes.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
      // Check which processes have exited
      for (const [agentId, proc] of this.processes) {
        if (proc.exitCode !== null || proc.killed) {
          this.processes.delete(agentId);
        }
      }
    }

    // SIGKILL any survivors
    for (const [agentId, proc] of this.processes) {
      this.logger.warn(`Force-killing agent ${agentId} (pid: ${proc.pid})`);
      if (proc.pid) {
        try {
          process.kill(-proc.pid, 'SIGKILL');
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ESRCH') {
            this.logger.error(`Failed to SIGKILL agent ${agentId}: ${e}`);
          }
        }
      }
    }

    this.processes.clear();

    // Drain the queue
    for (const waiter of this.queue) {
      waiter.resolve();
    }
    this.queue = [];
    this.running = 0;
    this._aborting = false;

    this.logger.log('All agents aborted');
    return agentIds;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.abortAll();
  }
}
