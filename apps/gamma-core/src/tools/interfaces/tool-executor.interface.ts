import type { AgentRole, ToolResult } from '@gamma/types';

/**
 * Execution context passed to every tool handler.
 * Populated by the ToolRegistryService from the calling session.
 */
export interface ToolExecutionContext {
  agentId: string;
  sessionKey: string;
  windowId: string;
  appId: string;
  role: AgentRole;
}

/**
 * Contract that every internal (NestJS-native) tool handler must implement.
 *
 * Each implementing class:
 *  1. Exposes a static `DEFINITION: ITool` with `type: 'internal'`.
 *  2. Sets `toolName` to match `DEFINITION.name`.
 *  3. Implements `execute()` — receives **already-validated** arguments.
 */
export interface IToolExecutor {
  /** Must match the ITool.name this executor handles. */
  readonly toolName: string;

  /**
   * Execute the tool with validated arguments.
   * @param args  — Input arguments (validated against ITool.schema by the registry).
   * @param context — Caller identity and permissions.
   */
  execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolResult>;
}
