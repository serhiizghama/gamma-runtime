import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ITool, ToolResult } from '@gamma/types';
import type { ToolExecutionContext } from './interfaces';

/** Request timeout for external tool invocations (ms). */
const EXTERNAL_TOOL_TIMEOUT_MS = 30_000;

/**
 * Handles HTTP dispatch of external tool calls to the OpenClaw Gateway.
 *
 * Every external tool registered in the ToolRegistry is proxied through
 * this service via POST /tools/invoke. Authentication is enforced on
 * every request via Bearer token.
 */
@Injectable()
export class ToolExecutorService {
  private readonly logger = new Logger(ToolExecutorService.name);

  /** HTTP base URL derived from the WS gateway URL (ws:// → http://). */
  private readonly gatewayHttpUrl: string;

  /** Bearer token for OpenClaw Gateway authentication. */
  private readonly gatewayToken: string;

  constructor(private readonly config: ConfigService) {
    const wsUrl = this.config.get<string>(
      'OPENCLAW_GATEWAY_URL',
      'ws://localhost:18789',
    );
    this.gatewayHttpUrl = wsUrl
      .replace('ws://', 'http://')
      .replace('wss://', 'https://');

    this.gatewayToken = this.config.get<string>(
      'OPENCLAW_GATEWAY_TOKEN',
      '',
    );

    if (!this.gatewayToken) {
      this.logger.warn(
        'OPENCLAW_GATEWAY_TOKEN not set — external tool calls will fail authentication',
      );
    }
  }

  /**
   * Proxy a tool invocation to the OpenClaw Gateway.
   *
   * POST ${gatewayHttpUrl}/tools/invoke
   * Headers: Authorization: Bearer <token>, Content-Type: application/json
   * Body: { tool, arguments, context }
   *
   * Returns a ToolResult — never throws.
   */
  async invokeExternal(
    tool: ITool,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    const start = performance.now();
    const url = `${this.gatewayHttpUrl}/tools/invoke`;

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      EXTERNAL_TOOL_TIMEOUT_MS,
    );

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.gatewayToken}`,
        },
        body: JSON.stringify({
          tool: tool.name,
          arguments: args,
          context,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '<unreadable>');
        this.logger.error(
          `External tool "${tool.name}" returned HTTP ${response.status}: ${body}`,
        );
        return {
          ok: false,
          toolName: tool.name,
          error: `Gateway returned HTTP ${response.status}: ${body}`,
          durationMs: performance.now() - start,
        };
      }

      const payload: unknown = await response.json();

      // Expect the gateway to return a ToolResult-shaped object.
      // Defensively wrap if the shape doesn't match.
      if (
        typeof payload === 'object' &&
        payload !== null &&
        'ok' in payload
      ) {
        const result = payload as ToolResult;
        return {
          ...result,
          toolName: tool.name,
          durationMs: performance.now() - start,
        };
      }

      // Gateway returned a non-standard shape — wrap it as data.
      return {
        ok: true,
        toolName: tool.name,
        data: payload,
        durationMs: performance.now() - start,
      };
    } catch (err: unknown) {
      const message =
        err instanceof DOMException && err.name === 'AbortError'
          ? `External tool "${tool.name}" timed out after ${EXTERNAL_TOOL_TIMEOUT_MS}ms`
          : `External tool "${tool.name}" failed: ${err instanceof Error ? err.message : String(err)}`;

      this.logger.error(message);

      return {
        ok: false,
        toolName: tool.name,
        error: message,
        durationMs: performance.now() - start,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
