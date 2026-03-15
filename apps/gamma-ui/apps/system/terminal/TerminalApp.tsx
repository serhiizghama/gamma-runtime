import React, { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { API_BASE } from "../../../constants/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type ConnStatus = "connecting" | "connected" | "disconnected" | "error";

const STATUS_COLOR: Record<ConnStatus, string> = {
  connecting:   "#ffd787",
  connected:    "#5fff87",
  disconnected: "#888",
  error:        "#ff5f5f",
};
const STATUS_LABEL: Record<ConnStatus, string> = {
  connecting:   "Connecting…",
  connected:    "Connected",
  disconnected: "Disconnected",
  error:        "Error",
};

// ─── Timeouts ─────────────────────────────────────────────────────────────────

const TOKEN_FETCH_TIMEOUT_MS = 8_000;   // max wait for /api/pty/token
const WS_CONNECT_TIMEOUT_MS  = 10_000;  // max wait for WebSocket onopen

// ─── WS URL helper ────────────────────────────────────────────────────────────

function getPtyWsUrl(token: string, cols: number, rows: number): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/pty?token=${encodeURIComponent(token)}&cols=${cols}&rows=${rows}`;
}

// ─── Inner session component (remounts on reconnect via key) ──────────────────

interface TerminalSessionProps {
  onStatusChange: (s: ConnStatus, msg?: string) => void;
}

function TerminalSession({ onStatusChange }: TerminalSessionProps): React.ReactElement {
  const containerRef  = useRef<HTMLDivElement>(null);
  const termRef       = useRef<Terminal | null>(null);
  const fitAddonRef   = useRef<FitAddon | null>(null);
  const wsRef         = useRef<WebSocket | null>(null);
  const wsTimeoutRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // ── 1. Create xterm ────────────────────────────────────────────────
    const term = new Terminal({
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.4,
      theme: {
        background:          "#0d1117",
        foreground:          "#e6edf3",
        cursor:              "#3fb950",
        cursorAccent:        "#0d1117",
        selectionBackground: "rgba(255,255,255,0.15)",
        black:          "#0d1117", red:          "#ff5f5f",
        green:          "#5fff87", yellow:       "#ffd787",
        blue:           "#5fd7ff", magenta:      "#d787ff",
        cyan:           "#5fffff", white:        "#e6edf3",
        brightBlack:    "#555",   brightRed:    "#ff8787",
        brightGreen:    "#87ffd7", brightYellow: "#ffffd7",
        brightBlue:     "#87d7ff", brightMagenta:"#ffafff",
        brightCyan:     "#87ffff", brightWhite:  "#ffffff",
      },
      cursorBlink: true,
      scrollback: 5000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    fitAddon.fit();
    termRef.current     = term;
    fitAddonRef.current = fitAddon;

    const { cols, rows } = term;

    // ── 2. Fetch one-time token, then open WebSocket ───────────────────
    const abortCtrl = new AbortController();

    (async () => {
      onStatusChange("connecting");

      let token: string;
      try {
        // Abort fetch after TOKEN_FETCH_TIMEOUT_MS even if server never responds
        const fetchAbort = AbortSignal.any
          ? AbortSignal.any([abortCtrl.signal, AbortSignal.timeout(TOKEN_FETCH_TIMEOUT_MS)])
          : abortCtrl.signal;

        term.write("\x1b[90m  Requesting PTY token…\x1b[0m\r\n");
        const res = await fetch(`${API_BASE}/api/pty/token`, {
          method: "POST",
          signal: fetchAbort,
        });
        if (!res.ok) throw new Error(`Token request failed: HTTP ${res.status}`);
        const body = (await res.json()) as { token?: unknown };
        if (typeof body.token !== "string" || !body.token) {
          throw new Error("Server returned invalid or missing PTY token");
        }
        token = body.token;
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        const isTimeout = (err as { name?: string }).name === "TimeoutError";
        const msg = isTimeout
          ? `Token request timed out after ${TOKEN_FETCH_TIMEOUT_MS / 1000}s — is the server running?`
          : err instanceof Error ? err.message : String(err);
        onStatusChange("error", msg);
        term.write(`\r\n\x1b[31m✗ ${msg}\x1b[0m\r\n`);
        console.error("[TerminalApp] Token fetch failed:", msg);
        return;
      }

      // ── 3. Open WS ──────────────────────────────────────────────────
      term.write("\x1b[90m  Opening PTY shell…\x1b[0m\r\n");
      const ws = new WebSocket(getPtyWsUrl(token, cols, rows));
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      // Timeout if WS never opens — stored in ref so cleanup can cancel it
      wsTimeoutRef.current = setTimeout(() => {
        wsTimeoutRef.current = null;
        if (ws.readyState !== WebSocket.OPEN) {
          const msg = `WebSocket did not connect within ${WS_CONNECT_TIMEOUT_MS / 1000}s`;
          onStatusChange("error", msg);
          term.write(`\r\n\x1b[31m✗ ${msg}\x1b[0m\r\n`);
          console.error("[TerminalApp] WS connect timeout");
          ws.close();
        }
      }, WS_CONNECT_TIMEOUT_MS);

      ws.onopen = () => {
        clearTimeout(wsTimeoutRef.current ?? undefined);
        wsTimeoutRef.current = null;
        console.log("[TerminalApp] WebSocket connected to PTY shell");
        onStatusChange("connected");
        term.write("\x1b[36m⬡ Gamma Agent Runtime\x1b[0m  \x1b[90mv2.0 · PTY Shell · macOS\x1b[0m\r\n");
        term.focus();
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(
            typeof ev.data === "string"
              ? ev.data
              : new TextDecoder().decode(ev.data as ArrayBuffer)
          ) as { type: string; data?: string; code?: number };
          if (msg.type === "data" && msg.data) {
            term.write(msg.data);
          } else if (msg.type === "exit") {
            onStatusChange("disconnected");
            term.write(`\r\n\x1b[33m[Shell exited with code ${msg.code ?? 0}]\x1b[0m\r\n`);
          }
        } catch { /* malformed — ignore */ }
      };

      ws.onerror = () => {
        clearTimeout(wsTimeoutRef.current ?? undefined);
        wsTimeoutRef.current = null;
        onStatusChange("error", "WebSocket error");
        term.write("\r\n\x1b[31m[Connection error]\x1b[0m\r\n");
      };

      ws.onclose = (ev) => {
        // 4500 = PTY spawn failed (our custom code)
        if (ev.code === 4500) {
          onStatusChange("error", "PTY spawn failed on server");
          term.write("\r\n\x1b[31m[PTY spawn failed — check server logs]\x1b[0m\r\n");
        } else if (ev.code !== 1000 && ev.code !== 1001) {
          onStatusChange("disconnected");
          term.write(`\r\n\x1b[33m[Disconnected (code ${ev.code})]\x1b[0m\r\n`);
        }
      };

      // ── 4. Forward user input ────────────────────────────────────────
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "data", data }));
        }
      });
    })();

    // ── 5. Sync terminal size to pty on resize ─────────────────────────
    const ro = new ResizeObserver(() => {
      try {
        fitAddonRef.current?.fit();
        const t = termRef.current;
        const w = wsRef.current;
        if (t && w?.readyState === WebSocket.OPEN) {
          w.send(JSON.stringify({ type: "resize", cols: t.cols, rows: t.rows }));
        }
      } catch { /* ignore mid-unmount */ }
    });
    if (containerRef.current) ro.observe(containerRef.current);

    // ── Cleanup ────────────────────────────────────────────────────────
    return () => {
      abortCtrl.abort();
      // DEF-2 fix: clear WS connect timeout to prevent use-after-free on unmount
      if (wsTimeoutRef.current !== null) {
        clearTimeout(wsTimeoutRef.current);
        wsTimeoutRef.current = null;
      }
      ro.disconnect();
      const w = wsRef.current;
      if (w) {
        w.onopen = w.onmessage = w.onerror = w.onclose = null;
        w.close();
        wsRef.current = null;
      }
      term.dispose();
      termRef.current     = null;
      fitAddonRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, overflow: "hidden", padding: "6px 4px 4px 6px" }}
    />
  );
}

// ─── TerminalApp (wrapper — manages reconnect via key) ────────────────────────

export function TerminalApp(): React.ReactElement {
  const [sessionKey, setSessionKey] = useState(0);
  const [status, setStatus]         = useState<ConnStatus>("connecting");
  const [errorMsg, setErrorMsg]     = useState("");

  const handleStatusChange = useCallback((s: ConnStatus, msg?: string) => {
    setStatus(s);
    setErrorMsg(msg ?? "");
  }, []);

  // Reconnect: bump key → TerminalSession unmounts + remounts fresh
  const reconnect = useCallback(() => {
    setStatus("connecting");
    setErrorMsg("");
    setSessionKey((k) => k + 1);
  }, []);

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: "#0d1117",
        overflow: "hidden",
      }}
    >
      {/* ── Status bar ──────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 12px",
          borderBottom: "1px solid #21262d",
          fontFamily: "'SF Mono', Menlo, Consolas, monospace",
          fontSize: 11,
          color: "#888",
          flexShrink: 0,
          userSelect: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: STATUS_COLOR[status],
              display: "inline-block",
              flexShrink: 0,
              boxShadow: status === "connected"
                ? `0 0 6px ${STATUS_COLOR[status]}`
                : "none",
              transition: "box-shadow 0.3s",
            }}
          />
          <span style={{ color: STATUS_COLOR[status] }}>
            {STATUS_LABEL[status]}
          </span>
          {errorMsg && (
            <span style={{ color: "#ff5f5f", marginLeft: 4 }}>
              — {errorMsg}
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ color: "#333" }}>zsh · macOS</span>
          {(status === "disconnected" || status === "error") && (
            <button
              onClick={reconnect}
              style={{
                background: "#161b22",
                border: "1px solid #30363d",
                borderRadius: 4,
                color: "#e6edf3",
                fontSize: 11,
                padding: "2px 10px",
                cursor: "pointer",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) =>
                ((e.target as HTMLButtonElement).style.background = "#21262d")
              }
              onMouseLeave={(e) =>
                ((e.target as HTMLButtonElement).style.background = "#161b22")
              }
            >
              ↺ Reconnect
            </button>
          )}
        </div>
      </div>

      {/* ── xterm session (key forces clean remount on reconnect) ────────── */}
      <TerminalSession
        key={sessionKey}
        onStatusChange={handleStatusChange}
      />
    </div>
  );
}
