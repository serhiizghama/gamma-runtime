import { Injectable, Logger } from '@nestjs/common';
import { spawn, ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { StreamChunk, RunOptions, RunResult } from './types';
import { parseLine } from './ndjson-parser';

const DEFAULT_TIMEOUT_MS = parseInt(process.env.AGENT_TIMEOUT_MS ?? '300000', 10);
const DEFAULT_MAX_TURNS = parseInt(process.env.CLAUDE_MAX_TURNS ?? '50', 10);

@Injectable()
export class ClaudeCliAdapter {
  private readonly logger = new Logger(ClaudeCliAdapter.name);

  async *run(opts: RunOptions): AsyncGenerator<StreamChunk> {
    const {
      message,
      cwd,
      systemPrompt,
      sessionId,
      timeoutMs = DEFAULT_TIMEOUT_MS,
      maxTurns = DEFAULT_MAX_TURNS,
    } = opts;

    const args: string[] = [];

    // Resume existing session if sessionId provided
    if (sessionId) {
      args.push('--resume', sessionId);
    }

    // Print mode — non-interactive, exits on completion
    args.push('-p', message);

    // CRITICAL: non-interactive flags
    args.push('--permission-mode', 'bypassPermissions');
    args.push('--output-format', 'stream-json');
    args.push('--verbose');
    args.push('--max-turns', String(maxTurns));

    // System prompt (role + team context)
    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    // Working directory
    args.push('--cwd', cwd);

    this.logger.log(`Spawning Claude CLI: session=${sessionId ?? 'new'}, cwd=${cwd}`);
    this.logger.debug(`Args: claude ${args.map(a => a.length > 100 ? a.slice(0, 100) + '...' : a).join(' ')}`);

    const proc = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });

    // Emit the process so session pool can register it
    yield { type: 'system', content: '', subtype: '_process_started' } as StreamChunk & { _proc?: ChildProcess };
    // Store proc reference accessible via getLastProcess()
    this._lastProc = proc;

    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      this.logger.warn(`Agent timed out after ${timeoutMs}ms, killing process group`);
      this.killProcessGroup(proc);
    }, timeoutMs);

    // Collect stderr for debugging
    let stderr = '';
    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    try {
      const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity });

      for await (const line of rl) {
        const chunk = parseLine(line);
        if (chunk) {
          yield chunk;
        }
      }

      // Wait for process to actually exit
      const exitCode = await new Promise<number | null>((resolve) => {
        proc.on('exit', (code) => resolve(code));
        // If already exited
        if (proc.exitCode !== null) resolve(proc.exitCode);
      });

      if (timedOut) {
        yield {
          type: 'error',
          content: `Agent timed out after ${timeoutMs}ms`,
        };
      } else if (exitCode !== 0 && exitCode !== null) {
        this.logger.warn(`Claude CLI exited with code ${exitCode}: ${stderr.slice(0, 500)}`);
        yield {
          type: 'error',
          content: `CLI exited with code ${exitCode}: ${stderr.slice(0, 200)}`,
        };
      }
    } finally {
      clearTimeout(timeout);
      this._lastProc = undefined;
    }
  }

  async runToCompletion(opts: RunOptions): Promise<RunResult> {
    let text = '';
    let sessionId = '';
    let durationMs = 0;
    let costUsd = 0;
    let numTurns = 0;
    let usage: RunResult['usage'];
    let modelUsage: RunResult['modelUsage'];

    for await (const chunk of this.run(opts)) {
      switch (chunk.type) {
        case 'text':
          text += chunk.content;
          break;
        case 'result':
          sessionId = chunk.sessionId ?? '';
          durationMs = chunk.durationMs ?? 0;
          costUsd = chunk.costUsd ?? 0;
          numTurns = chunk.numTurns ?? 0;
          usage = chunk.usage;
          modelUsage = chunk.modelUsage;
          break;
        case 'error':
          if (!text) text = chunk.content;
          break;
      }
    }

    return { sessionId, text, durationMs, costUsd, numTurns, usage, modelUsage };
  }

  killProcessGroup(proc: ChildProcess): void {
    if (proc.pid) {
      try {
        // Kill entire process group (negative PID)
        process.kill(-proc.pid, 'SIGTERM');
      } catch (e) {
        // ESRCH = process already exited — safe to ignore
        if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e;
      }
    }
  }

  getLastProcess(): ChildProcess | undefined {
    return this._lastProc;
  }

  private _lastProc?: ChildProcess;
}
