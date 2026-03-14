import React, { useEffect, useRef, useState, useCallback, KeyboardEvent } from "react";
import { API_BASE } from "../../../constants/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type Segment = { text: string; color?: string; bold?: boolean };

interface TerminalLine {
  id: number;
  segments: Segment[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _lineId = 0;
const makeId = () => ++_lineId;

function plain(text: string): TerminalLine {
  return { id: makeId(), segments: [{ text }] };
}

function colored(segments: Segment[]): TerminalLine {
  return { id: makeId(), segments };
}

function errorLine(text: string): TerminalLine {
  return colored([{ text, color: "#ff5f5f" }]);
}

function dimLine(text: string): TerminalLine {
  return colored([{ text, color: "#666" }]);
}

// ─── Built-in Commands ────────────────────────────────────────────────────────

const COMMANDS: Record<string, string> = {
  help:     "Show available commands",
  clear:    "Clear the terminal",
  echo:     "Print arguments",
  date:     "Show current date and time",
  whoami:   "Show current user info",
  version:  "Show Gamma Runtime version",
  health:   "Show system health (CPU, RAM, Redis, Gateway)",
  sessions: "List active agent sessions",
  uptime:   "Show system uptime",
  env:      "Show environment info",
  history:  "Show command history",
};

const COMMAND_NAMES = Object.keys(COMMANDS);

// ─── TerminalApp ──────────────────────────────────────────────────────────────

export function TerminalApp(): React.ReactElement {
  const [lines, setLines] = useState<TerminalLine[]>(() => [
    colored([
      { text: "Gamma Terminal", color: "#5fffff", bold: true },
      { text: " v2.0", color: "#888" },
    ]),
    dimLine("Type 'help' for available commands. Use ↑/↓ for history, Tab to autocomplete."),
    dimLine("─".repeat(55)),
  ]);

  const [input, setInput] = useState("");
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [suggestion, setSuggestion] = useState("");

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  // Update autocomplete suggestion
  useEffect(() => {
    if (!input.trim()) {
      setSuggestion("");
      return;
    }
    const cmd = input.split(" ")[0];
    const isTypingCmd = !input.includes(" ");
    if (isTypingCmd) {
      const match = COMMAND_NAMES.find((c) => c.startsWith(cmd) && c !== cmd);
      setSuggestion(match ? match.slice(cmd.length) : "");
    } else {
      setSuggestion("");
    }
  }, [input]);

  const append = useCallback((...newLines: TerminalLine[]) => {
    setLines((prev) => [...prev, ...newLines]);
  }, []);

  // ── Command handlers ──────────────────────────────────────────────────────

  const runHelp = useCallback(() => {
    const out: TerminalLine[] = [
      colored([{ text: "Available commands:", color: "#ffd787", bold: true }]),
    ];
    for (const [cmd, desc] of Object.entries(COMMANDS)) {
      out.push(
        colored([
          { text: `  ${cmd.padEnd(12)}`, color: "#5fd7ff" },
          { text: desc, color: "#ccc" },
        ])
      );
    }
    append(...out);
  }, [append]);

  const runEcho = useCallback((args: string[]) => {
    append(plain(args.join(" ")));
  }, [append]);

  const runDate = useCallback(() => {
    const now = new Date();
    append(
      colored([
        { text: now.toDateString() + " ", color: "#ffd787" },
        { text: now.toLocaleTimeString(), color: "#fff" },
      ])
    );
  }, [append]);

  const runWhoami = useCallback(() => {
    append(
      colored([
        { text: "user", color: "#5fff87" },
        { text: " @ ", color: "#888" },
        { text: "gamma-runtime", color: "#5fd7ff" },
      ]),
      colored([{ text: "  Role: AI App Manager", color: "#ccc" }]),
      colored([{ text: "  Shell: Gamma Terminal v2.0", color: "#ccc" }]),
    );
  }, [append]);

  const runVersion = useCallback(() => {
    append(
      colored([
        { text: "Gamma Agent Runtime", color: "#5fffff", bold: true },
        { text: " — UI Engine v2.0 / Core API v1.0", color: "#888" },
      ])
    );
  }, [append]);

  const runEnv = useCallback(() => {
    append(
      colored([{ text: "Environment:", color: "#ffd787", bold: true }]),
      colored([
        { text: "  NODE_ENV   ", color: "#5fd7ff" },
        { text: (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE ?? "development", color: "#fff" },
      ]),
      colored([
        { text: "  API_BASE   ", color: "#5fd7ff" },
        { text: API_BASE || "(proxy)", color: "#fff" },
      ]),
      colored([
        { text: "  UA         ", color: "#5fd7ff" },
        { text: navigator.userAgent.slice(0, 60) + "…", color: "#888" },
      ]),
    );
  }, [append]);

  const runUptime = useCallback(() => {
    const perf = Math.floor(performance.now() / 1000);
    const h = Math.floor(perf / 3600);
    const m = Math.floor((perf % 3600) / 60);
    const s = perf % 60;
    append(
      colored([
        { text: "Page uptime: ", color: "#888" },
        { text: `${h}h ${m}m ${s}s`, color: "#fff" },
      ])
    );
  }, [append]);

  const runHistory = useCallback((hist: string[]) => {
    if (!hist.length) {
      append(dimLine("(no history)"));
      return;
    }
    const out = hist.map((cmd, i) =>
      colored([
        { text: `  ${String(i + 1).padStart(3)}  `, color: "#555" },
        { text: cmd, color: "#ccc" },
      ])
    );
    append(...out);
  }, [append]);

  const runHealth = useCallback(async () => {
    append(dimLine("Fetching system health…"));
    try {
      const res = await fetch(`${API_BASE}/api/system/health`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const h = await res.json();

      const statusColor = h.status === "ok" ? "#5fff87" : h.status === "degraded" ? "#ffd787" : "#ff5f5f";
      const redisColor  = h.redis?.connected  ? "#5fff87" : "#ff5f5f";
      const gwColor     = h.gateway?.connected ? "#5fff87" : "#ff5f5f";

      append(
        colored([{ text: "System Health Report", color: "#ffd787", bold: true }]),
        colored([
          { text: "  Status   ", color: "#5fd7ff" },
          { text: h.status?.toUpperCase() ?? "?", color: statusColor, bold: true },
        ]),
        colored([
          { text: "  CPU      ", color: "#5fd7ff" },
          { text: `${h.cpu?.usagePct ?? "?"}%`, color: "#fff" },
        ]),
        colored([
          { text: "  RAM      ", color: "#5fd7ff" },
          { text: `${h.ram?.usedMb ?? "?"}MB / ${h.ram?.totalMb ?? "?"}MB (${h.ram?.usedPct ?? "?"}%)`, color: "#fff" },
        ]),
        colored([
          { text: "  Redis    ", color: "#5fd7ff" },
          { text: h.redis?.connected ? `OK (${h.redis.latencyMs}ms)` : "DOWN", color: redisColor },
        ]),
        colored([
          { text: "  Gateway  ", color: "#5fd7ff" },
          { text: h.gateway?.connected ? `OK (${h.gateway.latencyMs}ms)` : "DOWN", color: gwColor },
        ]),
      );

      if (h.eventLag) {
        append(
          colored([
            { text: "  EventLag ", color: "#5fd7ff" },
            { text: `avg ${h.eventLag.avgMs}ms / max ${h.eventLag.maxMs}ms (${h.eventLag.samples} samples)`, color: "#ccc" },
          ])
        );
      }
    } catch (err) {
      append(errorLine(`health: ${err instanceof Error ? err.message : String(err)}`));
    }
  }, [append]);

  const runSessions = useCallback(async () => {
    append(dimLine("Fetching sessions…"));
    try {
      const res = await fetch(`${API_BASE}/api/sessions`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const sessions: Array<{ id: string; appId?: string; status?: string }> =
        Array.isArray(data) ? data : (data.sessions ?? data.data ?? []);

      if (!sessions.length) {
        append(dimLine("No active sessions."));
        return;
      }

      append(colored([{ text: `Sessions (${sessions.length}):`, color: "#ffd787", bold: true }]));
      for (const s of sessions) {
        append(
          colored([
            { text: "  " + (s.id ?? "?").slice(0, 12) + "  ", color: "#555" },
            { text: s.appId ?? "unknown", color: "#5fd7ff" },
            { text: s.status ? `  [${s.status}]` : "", color: "#888" },
          ])
        );
      }
    } catch (err) {
      append(errorLine(`sessions: ${err instanceof Error ? err.message : String(err)}`));
    }
  }, [append]);

  // ── Dispatch ──────────────────────────────────────────────────────────────

  const execute = useCallback(async (raw: string, hist: string[]) => {
    const trimmed = raw.trim();
    if (!trimmed) return;

    // Echo the prompt line
    append(
      colored([
        { text: "▸ ", color: "#5fff87" },
        { text: trimmed, color: "#fff" },
      ])
    );

    const [cmd, ...args] = trimmed.split(/\s+/);

    switch (cmd.toLowerCase()) {
      case "help":    runHelp(); break;
      case "clear":   setLines([]); break;
      case "echo":    runEcho(args); break;
      case "date":    runDate(); break;
      case "whoami":  runWhoami(); break;
      case "version": runVersion(); break;
      case "env":     runEnv(); break;
      case "uptime":  runUptime(); break;
      case "history": runHistory(hist); break;
      case "health":  await runHealth(); break;
      case "sessions": await runSessions(); break;
      default:
        append(
          colored([
            { text: `command not found: `, color: "#ff5f5f" },
            { text: cmd, color: "#ff8787" },
            { text: "  (type 'help' for commands)", color: "#555" },
          ])
        );
    }
    append(plain(""));
  }, [append, runHelp, runEcho, runDate, runWhoami, runVersion, runEnv, runUptime, runHistory, runHealth, runSessions]);

  // ── Input handlers ────────────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    async (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        const cmd = input.trim();
        const newHist = cmd ? [...commandHistory, cmd] : commandHistory;
        if (cmd) setCommandHistory(newHist);
        setInput("");
        setHistoryIndex(-1);
        setSuggestion("");
        await execute(cmd, newHist);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const newIdx = Math.min(historyIndex + 1, commandHistory.length - 1);
        setHistoryIndex(newIdx);
        setInput(commandHistory[commandHistory.length - 1 - newIdx] ?? "");
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        const newIdx = Math.max(historyIndex - 1, -1);
        setHistoryIndex(newIdx);
        setInput(newIdx === -1 ? "" : commandHistory[commandHistory.length - 1 - newIdx] ?? "");
      } else if (e.key === "Tab") {
        e.preventDefault();
        if (suggestion) {
          setInput((prev) => prev + suggestion);
          setSuggestion("");
        }
      } else if (e.key === "l" && e.ctrlKey) {
        e.preventDefault();
        setLines([]);
      } else if (e.key === "c" && e.ctrlKey) {
        e.preventDefault();
        append(
          colored([{ text: "▸ " + input, color: "#888" }]),
          colored([{ text: "^C", color: "#ff5f5f" }]),
          plain(""),
        );
        setInput("");
        setHistoryIndex(-1);
      }
    },
    [input, commandHistory, historyIndex, suggestion, execute, append]
  );

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: "#0d1117",
        fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', 'Menlo', 'Consolas', monospace",
        fontSize: 13,
        color: "#e6edf3",
        overflow: "hidden",
        cursor: "text",
      }}
    >
      {/* ── Output ────────────────────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "14px 16px 6px",
          scrollbarWidth: "thin",
          scrollbarColor: "#333 transparent",
        }}
      >
        {lines.map((line) => (
          <div
            key={line.id}
            style={{ lineHeight: 1.75, whiteSpace: "pre-wrap", wordBreak: "break-all" }}
          >
            {line.segments.map((seg, si) => (
              <span
                key={si}
                style={{
                  color: seg.color ?? "inherit",
                  fontWeight: seg.bold ? 700 : 400,
                }}
              >
                {seg.text}
              </span>
            ))}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* ── Input row ─────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "8px 16px",
          borderTop: "1px solid #21262d",
          gap: 8,
          position: "relative",
        }}
      >
        <span style={{ color: "#3fb950", flexShrink: 0, fontSize: 14 }}>▸</span>

        {/* Ghost autocomplete suggestion */}
        <div
          style={{
            position: "absolute",
            left: 40,
            top: "50%",
            transform: "translateY(-50%)",
            pointerEvents: "none",
            fontSize: 13,
            fontFamily: "inherit",
            color: "transparent",
            whiteSpace: "pre",
          }}
        >
          {input}
          <span style={{ color: "#444" }}>{suggestion}</span>
        </div>

        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "#e6edf3",
            fontFamily: "inherit",
            fontSize: 13,
            caretColor: "#3fb950",
            position: "relative",
            zIndex: 1,
          }}
          placeholder=""
          autoFocus
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
      </div>
    </div>
  );
}
