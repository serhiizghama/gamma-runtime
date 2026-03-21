/**
 * TraceTerminal — Read-only, monospace log display for agent execution traces.
 *
 * Renders MemoryBusEntry items as color-coded, timestamped log lines with
 * auto-scroll behavior (only when the user is near the bottom).
 */

import { useEffect, useRef, type CSSProperties } from "react";
import type { MemoryBusEntry } from "@gamma/types";

// ── Props ─────────────────────────────────────────────────────────────────

interface Props {
  entries: MemoryBusEntry[];
  loading: boolean;
  connected: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────

const KIND_COLORS: Record<MemoryBusEntry["kind"], string> = {
  thought: "#a78bfa",
  tool_call: "#ffd787",
  tool_result: "#87d7ff",
  text: "#5fff87",
  answer: "#87afff",
};

const KIND_LABELS: Record<MemoryBusEntry["kind"], string> = {
  thought: "THINK",
  tool_call: "TOOL",
  tool_result: "RESULT",
  text: "TEXT",
  answer: "ANSWER",
};

const MONO_FONT = "'SF Mono', 'Fira Code', 'Cascadia Code', monospace";

// ── Styles ────────────────────────────────────────────────────────────────

const container: CSSProperties = {
  height: "100%",
  display: "flex",
  flexDirection: "column",
  background: "#0d1117",
  borderRadius: 6,
  border: "1px solid var(--color-border-subtle)",
  overflow: "hidden",
  fontFamily: MONO_FONT,
};

const toolbar: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "6px 12px",
  borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
  flexShrink: 0,
  fontSize: 11,
  color: "var(--color-text-secondary)",
};

const liveDot: CSSProperties = {
  display: "inline-block",
  width: 6,
  height: 6,
  borderRadius: "50%",
  background: "#28c840",
  marginRight: 6,
  animation: "pulse-live 1.5s ease-in-out infinite",
};

const scrollArea: CSSProperties = {
  flex: 1,
  overflow: "auto",
  padding: "8px 12px",
  fontSize: 11,
  lineHeight: 1.6,
};

const emptyState: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  color: "var(--color-text-secondary)",
  fontSize: 12,
  fontFamily: MONO_FONT,
};

const entryRow: CSSProperties = {
  display: "flex",
  gap: 8,
  padding: "2px 0",
  borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
};

const tsStyle: CSSProperties = {
  color: "rgba(255, 255, 255, 0.35)",
  flexShrink: 0,
  userSelect: "none",
};

const badgeBase: CSSProperties = {
  flexShrink: 0,
  width: 50,
  fontWeight: 700,
  fontSize: 10,
  letterSpacing: "0.03em",
  textAlign: "right",
};

const contentStyle: CSSProperties = {
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  color: "rgba(255, 255, 255, 0.82)",
};

// ── Helpers ───────────────────────────────────────────────────────────────

function formatTs(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

// ── Component ─────────────────────────────────────────────────────────────

export function TraceTerminal({ entries, loading, connected }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll when new entries arrive, only if user is near bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) {
      el.scrollTo({ top: el.scrollHeight });
    }
  }, [entries.length]);

  // Loading state
  if (loading && entries.length === 0) {
    return (
      <div style={container}>
        <div style={emptyState}>Loading trace...</div>
      </div>
    );
  }

  // Empty state
  if (!loading && entries.length === 0) {
    return (
      <div style={container}>
        <div style={emptyState}>No trace data</div>
      </div>
    );
  }

  return (
    <div style={container}>
      {/* Toolbar */}
      <div style={toolbar}>
        <span>{entries.length} entries</span>
        {connected && (
          <span style={{ display: "flex", alignItems: "center" }}>
            <span style={liveDot} />
            Live
          </span>
        )}
      </div>

      {/* Pulse animation for live dot */}
      <style>{`
        @keyframes pulse-live {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>

      {/* Log lines */}
      <div ref={scrollRef} style={scrollArea}>
        {entries.map((e) => {
          const color = KIND_COLORS[e.kind] ?? "var(--color-text-secondary)";
          const label = KIND_LABELS[e.kind] ?? e.kind.toUpperCase();
          const maxLen = e.kind === "tool_result" ? 200 : 300;
          return (
            <div key={e.id} style={entryRow}>
              <span style={tsStyle}>[{formatTs(e.ts)}]</span>
              <span style={{ ...badgeBase, color }}>{label}</span>
              <span style={contentStyle}>{truncate(e.content, maxLen)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
