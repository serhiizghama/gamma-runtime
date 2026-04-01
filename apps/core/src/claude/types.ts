import { ChildProcess } from 'child_process';

export interface StreamChunk {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'result' | 'system' | 'error' | 'unknown';
  content: string;
  toolName?: string;
  toolInput?: unknown;
  toolUseId?: string;
  sessionId?: string;
  costUsd?: number;
  durationMs?: number;
  isError?: boolean;
  usage?: UsageData;
  modelUsage?: Record<string, { contextWindow: number }>;
  numTurns?: number;
  subtype?: string;
}

export interface UsageData {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface RunResult {
  sessionId: string;
  text: string;
  durationMs: number;
  costUsd: number;
  usage?: UsageData;
  modelUsage?: Record<string, { contextWindow: number }>;
  numTurns: number;
}

export interface RunOptions {
  message: string;
  cwd: string;
  systemPrompt?: string;
  sessionId?: string;
  timeoutMs?: number;
  maxTurns?: number;
  agentId?: string;
}

export interface ProcessInfo {
  proc: ChildProcess;
  agentId: string;
  startedAt: number;
}
