// ── Service Names ─────────────────────────────────────────────────────────

export type ServiceName = 'gamma-core' | 'gamma-ui' | 'gamma-proxy';

// ── Crash Classification ──────────────────────────────────────────────────

export type CrashType =
  | 'HARD_CRASH'   // Process exited with non-zero code
  | 'SOFT_CRASH'   // Logical error caught at runtime (HMR, unhandled rejection)
  | 'BUILD_ERROR'; // Vite/tsc compilation failure

// ── Data Contracts ────────────────────────────────────────────────────────

export interface CrashReport {
  /** Discriminant for the Redis stream consumer */
  type: 'CRASH_REPORT';

  /** Which service crashed */
  service: ServiceName;

  /** Nature of the crash */
  crashType: CrashType;

  /** ISO-8601 timestamp */
  timestamp: string;

  /** The agent session ID responsible for the last file change, if known */
  agentSessionId: string | null;

  /** Absolute path of the file last modified before the crash, if known */
  affectedFile: string | null;

  /** Raw error text: stderr tail, HMR error message, or stack trace */
  errorLog: string;

  /** Process exit code for HARD_CRASH; null otherwise */
  exitCode: number | null;
}

export interface AgentFeedback {
  type: 'WATCHDOG_FEEDBACK';
  targetAgentSessionId: string;
  timestamp: string;
  affectedFile: string | null;
  errorLog: string;
  /** Human-readable instruction injected as a system message for the agent */
  instruction: string;
}

export interface SessionAbort {
  type: 'SESSION_ABORT';
  targetAgentSessionId: string;
  /** ISO-8601 timestamp */
  timestamp: string;
  /** Human-readable reason logged by the gateway before terminating the SSE connection */
  reason: string;
}

export interface SessionUnfreeze {
  type: 'SESSION_UNFREEZE';
  targetAgentSessionId: string;
  timestamp: string;
}
