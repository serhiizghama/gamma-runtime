/**
 * useAgentTrace — On-demand hook for fetching historical + live agent trace data.
 *
 * Only activates when `enabled === true` AND `agentId` is non-null.
 * Combines a one-shot REST fetch with a live SSE stream, capping total
 * entries at 500 to bound memory usage.
 */

import { useCallback, useEffect, useState } from "react";
import type { MemoryBusEntry } from "@gamma/types";
import { systemAuthHeaders } from "../lib/auth";
import { API_BASE } from "../constants/api";
import { useSecureSse } from "./useSecureSse";

// ── Public types ──────────────────────────────────────────────────────────

export interface UseAgentTraceOptions {
  agentId: string | null;
  enabled: boolean;
}

export interface UseAgentTraceResult {
  entries: MemoryBusEntry[];
  loading: boolean;
  connected: boolean;
}

// ── Internals ─────────────────────────────────────────────────────────────

const MAX_ENTRIES = 500;

let sseSeq = 0;

function mapSseTypeToKind(
  type: string,
): MemoryBusEntry["kind"] | null {
  if (type === "thinking") return "thought";
  if (type === "tool_call") return "tool_call";
  if (type === "tool_result") return "tool_result";
  if (type === "assistant_delta" || type === "assistant_update") return "text";
  return null;
}

function extractContent(data: Record<string, unknown>): string {
  if (typeof data.text === "string") return data.text;
  if (typeof data.tool === "string") return data.tool;
  if (typeof data.content === "string") return data.content;
  return JSON.stringify(data).slice(0, 200);
}

function cap(entries: MemoryBusEntry[]): MemoryBusEntry[] {
  return entries.length > MAX_ENTRIES
    ? entries.slice(entries.length - MAX_ENTRIES)
    : entries;
}

// ── Hook ──────────────────────────────────────────────────────────────────

export function useAgentTrace({
  agentId,
  enabled,
}: UseAgentTraceOptions): UseAgentTraceResult {
  const [entries, setEntries] = useState<MemoryBusEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const active = enabled && agentId != null;

  // ── Historical fetch ────────────────────────────────────────────────────

  useEffect(() => {
    if (!active || agentId == null) {
      setEntries([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setEntries([]);

    fetch(
      `${API_BASE}/api/agents/${encodeURIComponent(agentId)}/trace?count=200`,
      { headers: systemAuthHeaders(), signal: controller.signal },
    )
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ ok: boolean; trace: MemoryBusEntry[] }>;
      })
      .then((data) => setEntries(cap(data.trace)))
      .catch((err) => {
        if (err instanceof Error && err.name === "AbortError") return;
        console.error("[useAgentTrace] fetch failed:", err);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [agentId, active]);

  // ── SSE live stream ─────────────────────────────────────────────────────

  const handleMessage = useCallback((ev: MessageEvent) => {
    try {
      const data = JSON.parse(ev.data as string) as Record<string, unknown>;
      const type = data.type as string | undefined;
      if (!type) return;
      if (type === "keep_alive" || type === "trace_end") return;

      const kind = mapSseTypeToKind(type);
      if (kind == null) return;

      const entry: MemoryBusEntry = {
        id: `sse-${++sseSeq}`,
        sessionKey: "",
        windowId: (data.windowId as string) ?? "",
        kind,
        content: extractContent(data),
        ts: Date.now(),
        stepId: (data.runId as string) ?? "",
      };

      setEntries((prev) => cap([...prev, entry]));
    } catch {
      // ignore malformed SSE payloads
    }
  }, []);

  const ssePath =
    active && agentId != null
      ? `/api/agents/${encodeURIComponent(agentId)}/trace/stream`
      : "";

  const { connected } = useSecureSse({
    path: ssePath,
    onMessage: handleMessage,
    reconnectMs: 5000,
    label: "AgentTrace",
    enabled: active && ssePath.length > 0,
  });

  return { entries, loading, connected };
}
