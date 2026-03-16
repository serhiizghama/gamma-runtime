import {
  Injectable,
  Logger,
  OnModuleInit,
  Inject,
  Optional,
} from '@nestjs/common';
import Ajv, { type ValidateFunction } from 'ajv';
import type {
  ITool,
  ToolResult,
  ToolSchema,
  ToolParameterSchema,
  AgentRole,
} from '@gamma/types';
import type { IToolExecutor, ToolExecutionContext } from './interfaces';
import { TOOL_EXECUTORS, EXTERNAL_TOOL_DEFINITIONS } from './constants';
import { ToolExecutorService } from './tool-executor.service';
import { ActivityStreamService } from '../activity/activity-stream.service';

// ── Ajv Schema Compiler ─────────────────────────────────────────────────

/**
 * Convert our ToolParameterSchema → standard JSON Schema (draft-07 compatible).
 * Ajv needs { type, properties, required } at the root level.
 */
interface JsonSchemaObject {
  type: 'object';
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
  additionalProperties: boolean;
}

function toJsonSchema(parameters: Record<string, ToolParameterSchema>): JsonSchemaObject {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  for (const [key, param] of Object.entries(parameters)) {
    const prop: Record<string, unknown> = { type: param.type };

    if (param.description) prop.description = param.description;
    if (param.enum) prop.enum = param.enum;
    if (param.default !== undefined) prop.default = param.default;

    if (param.type === 'object' && param.properties) {
      const nested = toJsonSchema(param.properties);
      Object.assign(prop, nested);
    }

    if (param.type === 'array' && param.items) {
      const wrapper = toJsonSchema({ _item: param.items });
      prop.items = wrapper.properties['_item'] ?? {};
    }

    properties[key] = prop;

    if (param.required) {
      required.push(key);
    }
  }

  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}

// ── ToolRegistryService ─────────────────────────────────────────────────

@Injectable()
export class ToolRegistryService implements OnModuleInit {
  private readonly logger = new Logger(ToolRegistryService.name);

  /** All registered tool definitions, keyed by tool name. */
  private readonly tools = new Map<string, ITool>();

  /** Internal tool executors, keyed by tool name. */
  private readonly executors = new Map<string, IToolExecutor>();

  /** Compiled Ajv validators, keyed by tool name. Lazily populated. */
  private readonly validators = new Map<string, ValidateFunction>();

  private readonly ajv = new Ajv({ allErrors: true, strict: false });

  constructor(
    private readonly toolExecutor: ToolExecutorService,
    @Optional() private readonly activityStream: ActivityStreamService | null,
    @Optional()
    @Inject(TOOL_EXECUTORS)
    private readonly injectedExecutors: IToolExecutor[] | null,
  ) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────

  onModuleInit(): void {
    // 1. Register all external tool definitions.
    for (const tool of EXTERNAL_TOOL_DEFINITIONS) {
      this.register(tool);
    }

    // 2. Register internal tools provided via TOOL_EXECUTORS multi-provider.
    if (this.injectedExecutors) {
      for (const executor of this.injectedExecutors) {
        // The executor's class must expose a static DEFINITION.
        const ctor = executor.constructor as { DEFINITION?: ITool };
        if (!ctor.DEFINITION) {
          this.logger.warn(
            `Executor "${executor.toolName}" has no static DEFINITION — skipped`,
          );
          continue;
        }
        this.register(ctor.DEFINITION, executor);
      }
    }

    this.logger.log(
      `Initialized with ${this.tools.size} tools ` +
        `(${this.executors.size} internal, ` +
        `${this.tools.size - this.executors.size} external)`,
    );
  }

  // ── Registration ──────────────────────────────────────────────────────

  /**
   * Register a tool definition and optionally bind an internal executor.
   * Duplicate names will overwrite — last-write-wins (allows hot-reload).
   */
  register(tool: ITool, executor?: IToolExecutor): void {
    if (executor && executor.toolName !== tool.name) {
      throw new Error(
        `Executor toolName "${executor.toolName}" does not match ` +
          `tool definition name "${tool.name}"`,
      );
    }

    this.tools.set(tool.name, tool);

    if (executor) {
      this.executors.set(tool.name, executor);
    }

    // Pre-compile the Ajv validator for this tool's parameter schema.
    const jsonSchema = toJsonSchema(tool.schema.parameters);
    this.validators.set(tool.name, this.ajv.compile(jsonSchema));

    this.logger.debug(`Registered tool: ${tool.name} [${tool.type}]`);
  }

  // ── Invocation ────────────────────────────────────────────────────────

  /**
   * Invoke a tool by name.
   *
   * Flow:
   *  1. Lookup tool definition.
   *  2. Verify the caller's role is permitted.
   *  3. Validate arguments against the tool's JSON Schema (Ajv).
   *  4. Route to internal executor or external proxy.
   */
  async invoke(
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    const start = performance.now();

    // 1. Lookup
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        ok: false,
        toolName: name,
        error: `Unknown tool: "${name}"`,
        durationMs: performance.now() - start,
      };
    }

    // 2. Role check
    if (!tool.allowedRoles.includes(context.role)) {
      return {
        ok: false,
        toolName: name,
        error: `Role "${context.role}" is not permitted to invoke "${name}". ` +
          `Allowed: [${tool.allowedRoles.join(', ')}]`,
        durationMs: performance.now() - start,
      };
    }

    // 3. Argument validation (Ajv)
    const validate = this.validators.get(name);
    if (validate && !validate(args)) {
      const errors = validate.errors
        ?.map((e) => `${e.instancePath || '/'} ${e.message}`)
        .join('; ');
      return {
        ok: false,
        toolName: name,
        error: `Argument validation failed: ${errors}`,
        durationMs: performance.now() - start,
      };
    }

    // 4. Activity Stream — tool_call_start
    this.activityStream?.emit({
      kind: 'tool_call_start',
      agentId: context.agentId,
      windowId: context.windowId || undefined,
      toolName: name,
      payload: JSON.stringify(args).slice(0, 200),
      severity: 'info',
    });

    // 5. Route
    let result: ToolResult;

    if (tool.type === 'internal') {
      const executor = this.executors.get(name);
      if (!executor) {
        result = {
          ok: false,
          toolName: name,
          error: `Internal tool "${name}" has no registered executor`,
          durationMs: performance.now() - start,
        };
      } else {
        try {
          const execResult = await executor.execute(args, context);
          result = {
            ...execResult,
            durationMs: performance.now() - start,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(`Internal tool "${name}" threw: ${message}`);
          result = {
            ok: false,
            toolName: name,
            error: `Internal execution error: ${message}`,
            durationMs: performance.now() - start,
          };
        }
      }
    } else {
      // External tool — proxy to OpenClaw Gateway
      result = await this.toolExecutor.invokeExternal(tool, args, context);
    }

    // 6. Activity Stream — tool_call_end
    this.activityStream?.emit({
      kind: 'tool_call_end',
      agentId: context.agentId,
      windowId: context.windowId || undefined,
      toolName: name,
      payload: JSON.stringify(result.data ?? result.error ?? '').slice(0, 200),
      severity: result.ok ? 'info' : 'error',
    });

    return result;
  }

  // ── Query ─────────────────────────────────────────────────────────────

  /**
   * Return all tool definitions accessible to the given role.
   * Used by ContextInjectorService to build the LLM prompt.
   */
  getManifest(role: AgentRole): ITool[] {
    const result: ITool[] = [];
    for (const tool of this.tools.values()) {
      if (tool.allowedRoles.includes(role)) {
        result.push(tool);
      }
    }
    return result;
  }

  /** Return the schema for a specific tool, or null if not found. */
  getToolSchema(name: string): ToolSchema | null {
    return this.tools.get(name)?.schema ?? null;
  }

  /** Check whether a tool is registered. */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Return the full tool definition, or undefined. */
  get(name: string): ITool | undefined {
    return this.tools.get(name);
  }

  /** Total number of registered tools. */
  get size(): number {
    return this.tools.size;
  }
}
