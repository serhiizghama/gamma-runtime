/**
 * Tool definition re-exports from @gamma/types.
 *
 * Centralises imports for gamma-core consumers so internal code never
 * reaches into the shared package directly for tool-related types.
 */
export type {
  ITool,
  ToolType,
  ToolSchema,
  ToolParameterSchema,
  ToolResult,
} from '@gamma/types';
