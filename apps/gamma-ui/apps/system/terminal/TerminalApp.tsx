import React, { useEffect, useRef, useState, useCallback, KeyboardEvent } from "react";
import { API_BASE } from "../../../constants/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type Segment = { text: string; color?: string; bold?: boolean };

interface TerminalLine {
  id: number;
  segments: Segment[];
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
  // FIX #4: _lineId moved inside component as a ref — no longer a shared global.
  const lineIdRef = useRef(0);
  const makeId = useCallback(() => ++lineIdRef.current, []);

  const makePlain = useCallback((text: string): TerminalLine => (
    { id: makeId(), segments: [{ text }] }
  ), [makeId]);

  const makeColored = useCallback((segments: Segment[]): TerminalLine => (
    { id: makeId(), segments }
  ), [makeId]);

  const makeError = useCallback((text: string): TerminalLine => (
    makeColored([{ text, color: "#ff5f5f" }])
  ), [makeColored]);

  const makeDim = useCallback((text: string): TerminalLine => (
    makeColored([{ text, color: "#666" }])
  ), [makeColored]);

  const [lines, setLines] = useState<TerminalLine[]>(() => [
    { id: 1, segments: [
      { text: "Gamma Terminal", color: "#5fffff", bold: true },
      { text: " v2.0", color: "#888" },
    ]},
    { id: 2, segments: [{ text: "Type 'help' for available commands. Use ↑/↓ for history, Tab to autocomplete.", color: "#666" }]},
    { id: 3, segments: [{ text: "─".repeat(55), color: "#666" }]},
  ]);

  const [input, setInput] = useState("");
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [suggestion, setSuggestion] = useState("");

  // FIX #2: isExecuting flag — prevents parallel command execution
  const isExecuting = useRef(false);

  // FIX #1: store current AbortController to cancel in-flight requests on unmount
  const abortRef = useRef<AbortController | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // FIX #1: cleanup — abort any in-flight fetch on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  // Update autocomplete suggestion
  useEffect(() => {
    if (!input.trim()) { setSuggestion(""); return; }
    const cmd = input.split(" ")[0];
    if (!input.includes(" ")) {
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
      makeColored([{ text: "Available commands:", color: "#ffd787", bold: true }]),
    ];
    for (const [cmd, desc] of Object.entries(COMMANDS)) {
      out.push(makeColored([
        { text: `  ${cmd.padEnd(12)}`, color: "#5fd7ff" },
        { text: desc, color: "#ccc" },
      ]));
    }
    append(...out);
  }, [append, makeColored]);

  const runEcho = useCallback((args: string[]) => {
    append(makePlain(args.join(" ")));
  }, [append, makePlain]);

  const runDate = useCallback(() => {
    const now = new Date();
    append(makeColored([
      { text: now.toDateString() + " ", color: "#ffd787" },
      { text: now.toLocaleTimeString(), color: "#fff" },
    ]));
  }, [append, makeColored]);

  const runWhoami = useCallback(() => {
    append(
      makeColored([
        { text: "user", color: "#5fff87" },
        { text: " @ ", color: "#888" },
        { text: "gamma-runtime", color: "#5fd7ff" },
      ]),
      makeColored([{ text: "  Role: AI App Manager", color: "#ccc" }]),
      makeColored([{ text: "  Shell: Gamma Terminal v2.0", color: "#ccc" }]),
    );
  }, [append, makeColored]);

  const runVersion = useCallback(() => {
    append(makeColored([
      { text: "Gamma Agent Runtime", color: "#5fffff", bold: true },
      { text: " — UI Engine v2.0 / Core API v1.0", color: "#888" },
    ]));
  }, [append, makeColored]);

  const runEnv = useCallback(() => {
    append(
      makeColored([{ text: "Environment:", color: "#ffd787", bold: true }]),
      makeColored([
        { text: "  NODE_ENV   ", color: "#5fd7ff" },
        { text: (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE ?? "development", color: "#fff" },
      ]),
      makeColored([
        { text: "  API_BASE   ", color: "#5fd7ff" },
        { text: API_BASE || "(proxy)", color: "#fff" },
      ]),
      makeColored([
        { text: "  UA         ", color: "#5fd7ff" },
        { text: navigator.userAgent.slice(0, 60) + "…", color: "#888" },
      ]),
    );
  }, [append, makeColored]);

  const runUptime = useCallback(() => {
    const perf = Math.floor(performance.now() / 1000);
    const h = Math.floor(perf / 3600);
    const m = Math.floor((perf % 3600) / 60);
    const s = perf % 60;
    append(makeColored([
      { text: "Page uptime: ", color: "#888" },
      { text: `${h}h ${m}m ${s}s`, color: "#fff" },
    ]));
  }, [append, makeColored]);

  const runHistory = useCallback((hist: string[]) => {
    if (!hist.length) { append(makeDim("(no history)")); return; }
    append(...hist.map((cmd, i) =>
      makeColored([
        { text: `  ${String(i + 1).padStart(3)}  `, color: "#555" },
        { text: cmd, color: "#ccc" },
      ])
    ));
  }, [append, makeDim, makeColored]);

  // FIX #1: AbortController wired into runHealth
  const runHealth = useCallback(async () => {
    append(makeDim("Fetching system health…"));
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(`${API_BASE}/api/system/health`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const h = await res.json();

      const statusColor = h.status === "ok" ? "#5fff87" : h.status === "degraded" ? "#ffd787" : "#ff5f5f";
      const redisColor  = h.redis?.connected  ? "#5fff87" : "#ff5f5f";
      const gwColor     = h.gateway?.connected ? "#5fff87" : "#ff5f5f";

      append(
        makeColored([{ text: "System Health Report", color: "#ffd787", bold: true }]),
        makeColored([
          { text: "  Status   ", color: "#5fd7ff" },
          { text: h.status?.toUpperCase() ?? "?", color: statusColor, bold: true },
        ]),
        makeColored([
          { text: "  CPU      ", color: "#5fd7ff" },
          { text: `${h.cpu?.usagePct ?? "?"}%`, color: "#fff" },
        ]),
        makeColored([
          { text: "  RAM      ", color: "#5fd7ff" },
          { text: `${h.ram?.usedMb ?? "?"}MB / ${h.ram?.totalMb ?? "?"}MB (${h.ram?.usedPct ?? "?"}%)`, color: "#fff" },
        ]),
        makeColored([
          { text: "  Redis    ", color: "#5fd7ff" },
          { text: h.redis?.connected ? `OK (${h.redis.latencyMs}ms)` : "DOWN", color: redisColor },
        ]),
        makeColored([
          { text: "  Gateway  ", color: "#5fd7ff" },
          { text: h.gateway?.connected ? `OK (${h.gateway.latencyMs}ms)` : "DOWN", color: gwColor },
        ]),
      );

      if (h.eventLag) {
        append(makeColored([
          { text: "  EventLag ", color: "#5fd7ff" },
          { text: `avg ${h.eventLag.avgMs}ms / max ${h.eventLag.maxMs}ms (${h.eventLag.samples} samples)`, color: "#ccc" },
        ]));
      }
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      append(makeError(`health: ${err instanceof Error ? err.message : String(err)}`));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [append, makeDim, makeColored, makeError]);

  // FIX #1: AbortController wired into runSessions
  const runSessions = useCallback(async () => {
    append(makeDim("Fetching sessions…"));
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(`${API_BASE}/api/sessions`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const sessions: Array<{ id: string; appId?: string; status?: string }> =
        Array.isArray(data) ? data : (data.sessions ?? data.data ?? []);

      if (!sessions.length) { append(makeDim("No active sessions.")); return; }

      append(makeColored([{ text: `Sessions (${sessions.length}):`, color: "#ffd787", bold: true }]));
      for (const s of sessions) {
        append(makeColored([
          { text: "  " + (s.id ?? "?").slice(0, 12) + "  ", color: "#555" },
          { text: s.appId ?? "unknown", color: "#5fd7ff" },
          { text: s.status ? `  [${s.status}]` : "", color: "#888" },
        ]));
      }
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      append(makeError(`sessions: ${err instanceof Error ? err.message : String(err)}`));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [append, makeDim, makeColored, makeError]);

  // ── Dispatch ──────────────────────────────────────────────────────────────

  const execute = useCallback(async (raw: string, hist: string[]) => {
    const trimmed = raw.trim();
    if (!trimmed) return;

    append(makeColored([
      { text: "▸ ", color: "#5fff87" },
      { text: trimmed, color: "#fff" },
    ]));

    const [cmd, ...args] = trimmed.split(/\s+/);

    switch (cmd.toLowerCase()) {
      case "help":     runHelp(); break;
      case "clear":    setLines([]); break;
      case "echo":     runEcho(args); break;
      case "date":     runDate(); break;
      case "whoami":   runWhoami(); break;
      case "version":  runVersion(); break;
      case "env":      runEnv(); break;
      case "uptime":   runUptime(); break;
      case "history":  runHistory(hist); break;
      case "health":   await runHealth(); break;
      case "sessions": await runSessions(); break;
      default:
        append(makeColored([
          { text: `command not found: `, color: "#ff5f5f" },
          { text: cmd, color: "#ff8787" },
          { text: "  (type 'help' for commands)", color: "#555" },
        ]));
    }
    append(makePlain(""));
  }, [append, makeColored, makePlain, runHelp, runEcho, runDate, runWhoami, runVersion, runEnv, runUptime, runHistory, runHealth, runSessions]);

  // ── Input handlers ────────────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    // FIX #3: wrapped in try/catch — async errors are now properly caught
    async (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        // FIX #2: block parallel execution
        if (isExecuting.current) return;

        const cmd = input.trim();
        const newHist = cmd ? [...commandHistory, cmd] : commandHistory;
        if (cmd) setCommandHistory(newHist);
        setInput("");
        setHistoryIndex(-1);
        setSuggestion("");

        isExecuting.current = true;
        try {
          await execute(cmd, newHist);
        } catch (err) {
          // FIX #3: catch errors that escape execute() itself
          setLines((prev) => [
            ...prev,
            { id: lineIdRef.current + 1, segments: [{ text: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`, color: "#ff5f5f" }] },
          ]);
          lineIdRef.current++;
        } finally {
          isExecuting.current = false;
        }

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
        // Also abort any in-flight fetch
        abortRef.current?.abort();
        isExecuting.current = false;
        append(
          makeColored([{ text: "▸ " + input, color: "#888" }]),
          makeColored([{ text: "^C", color: "#ff5f5f" }]),
          makePlain(""),
        );
        setInput("");
        setHistoryIndex(-1);
      }
    },
    [input, commandHistory, historyIndex, suggestion, execute, append, makeColored, makePlain]
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
                style={{ color: seg.color ?? "inherit", fontWeight: seg.bold ? 700 : 400 }}
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
        }}
      >
        <span style={{ color: "#3fb950", flexShrink: 0, fontSize: 14 }}>▸</span>

        {/* FIX #5: ghost overlay now uses a relative wrapper — no hardcoded left offset */}
        <div style={{ position: "relative", flex: 1, display: "flex", alignItems: "center" }}>
          {/* Ghost autocomplete: invisible mirror of input + colored suggestion */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              fontSize: 13,
              fontFamily: "inherit",
              whiteSpace: "pre",
              display: "flex",
              alignItems: "center",
            }}
          >
            <span style={{ visibility: "hidden" }}>{input}</span>
            <span style={{ color: "#444" }}>{suggestion}</span>
          </div>

          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{
              width: "100%",
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
    </div>
  );
}
