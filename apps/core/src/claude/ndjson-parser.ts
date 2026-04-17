import { Logger } from '@nestjs/common';
import { StreamChunk } from './types';

const logger = new Logger('NdjsonParser');

export function parseLine(line: string): StreamChunk | null {
  if (!line.trim()) return null;

  let obj: unknown;
  try {
    obj = JSON.parse(line);
  } catch {
    logger.warn(`Unparseable CLI output: ${line.slice(0, 200)}`);
    return null;
  }

  return classifyChunk(obj);
}

function classifyChunk(obj: unknown): StreamChunk {
  if (!obj || typeof obj !== 'object') {
    return { type: 'unknown', content: String(obj) };
  }

  const data = obj as Record<string, unknown>;

  // Result chunk (always last)
  if (data.type === 'result') {
    return {
      type: 'result',
      content: (data.result as string) ?? '',
      sessionId: data.session_id as string | undefined,
      costUsd: (data.total_cost_usd ?? data.cost_usd) as number | undefined,
      durationMs: data.duration_ms as number | undefined,
      isError: data.is_error as boolean | undefined,
      usage: data.usage as StreamChunk['usage'],
      modelUsage: (data.model_usage ?? data.modelUsage) as StreamChunk['modelUsage'],
      numTurns: data.num_turns as number | undefined,
    };
  }

  // Rate limit events — pass through as system
  if (data.type === 'rate_limit_event') {
    return {
      type: 'system',
      content: JSON.stringify(data),
      subtype: 'rate_limit',
    };
  }

  // System events (init, retries, errors, etc.)
  if (data.type === 'system') {
    return {
      type: 'system',
      content: JSON.stringify(data),
      subtype: data.subtype as string | undefined,
      sessionId: data.session_id as string | undefined,
    };
  }

  // Assistant messages (text, tool_use, thinking)
  if (data.type === 'assistant') {
    const message = data.message as Record<string, unknown> | undefined;
    const contentArr = message?.content as Array<Record<string, unknown>> | undefined;

    if (!contentArr || !Array.isArray(contentArr)) {
      return { type: 'unknown', content: JSON.stringify(data) };
    }

    // Extract per-API-call usage from the assistant message
    const msgUsage = message?.usage as StreamChunk['usage'] | undefined;

    // Process each content block
    for (const block of contentArr) {
      if (block.type === 'text') {
        return { type: 'text', content: block.text as string ?? '', usage: msgUsage };
      }
      if (block.type === 'tool_use') {
        return {
          type: 'tool_use',
          content: '',
          toolName: block.name as string,
          toolInput: block.input,
          toolUseId: block.id as string,
          usage: msgUsage,
        };
      }
      if (block.type === 'thinking') {
        return { type: 'thinking', content: block.thinking as string ?? '', usage: msgUsage };
      }
    }

    return { type: 'unknown', content: JSON.stringify(data) };
  }

  // User messages (tool results)
  if (data.type === 'user') {
    const message = data.message as Record<string, unknown> | undefined;
    const contentArr = message?.content as Array<Record<string, unknown>> | undefined;

    if (contentArr && Array.isArray(contentArr)) {
      for (const block of contentArr) {
        if (block.type === 'tool_result') {
          return {
            type: 'tool_result',
            content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? ''),
            toolUseId: block.tool_use_id as string,
          };
        }
      }
    }

    return { type: 'unknown', content: JSON.stringify(data) };
  }

  return { type: 'unknown', content: JSON.stringify(data) };
}
