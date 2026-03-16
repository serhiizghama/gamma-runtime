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

const TOKEN_FETCH_TIMEOUT_MS = 8_000;    // max wait for /api/pty/token
const WS_CONNECT_TIMEOUT_MS  = 10_000;  // max wait for WebSocket onopen
const MAX_FRAME_BYTES        = 256 * 1024; // discard server frames larger than 256 KB

// ─── WS URL helper ────────────────────────────────────────────────────────────
// DEF-1 fix: token is NO LONGER passed in the URL query string (leaks to logs).
// Authentication is performed via a first-message handshake after WS open.

function getPtyWsUrl(cols: number, rows: number): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/pty?cols=${cols}&rows=${rows}`;
}

// ─── Inner session component (remounts on reconnect via key) ──────────────────

interface TerminalSessionProps {
  onStatusChange: (s: ConnStatus, msg?: string) => void;
  /** Shell/OS identifier sourced from server handshake, e.g. "zsh · macOS" */
  onHandshake?: (info: { shell: string; os: string }) => void;
}

function TerminalSession({ onStatusChange, onHandshake }: TerminalSessionProps): React.ReactElement {
  const containerRef      = useRef<HTMLDivElement>(null);
  const termRef           = useRef<Terminal | null>(null);
  const fitAddonRef       = useRef<FitAddon | null>(null);
  const wsRef             = useRef<WebSocket | null>(null);
  const wsTimeoutRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Store prop callbacks in refs so the effect closure is never stale even if
  // the parent passes a new reference — makes the empty dep-array contract explicit.
  const onStatusChangeRef = useRef(onStatusChange);
  const onHandshakeRef    = useRef(onHandshake);
  onStatusChangeRef.current = onStatusChange;
  onHandshakeRef.current    = onHandshake;

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
      onStatusChangeRef.current("connecting");

      let token: string;
      try {
        // Abort fetch after TOKEN_FETCH_TIMEOUT_MS even if server never responds.
        // AbortSignal.any is a static method — its truthiness check is always reliable
        // when present. Fallback: AbortSignal.timeout() gives an independent deadline
        // on older browsers (Safari <16.4, older Chromium) that lack AbortSignal.any,
        // ensuring TOKEN_FETCH_TIMEOUT_MS is never silently dropped.
        const fetchAbort = AbortSignal.any
          ? AbortSignal.any([abortCtrl.signal, AbortSignal.timeout(TOKEN_FETCH_TIMEOUT_MS)])
          : AbortSignal.timeout
            ? AbortSignal.timeout(TOKEN_FETCH_TIMEOUT_MS)
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
        onStatusChangeRef.current("error", msg);
        term.write(`\r\n\x1b[31m✗ ${msg}\x1b[0m\r\n`);
        console.error("[TerminalApp] Token fetch failed:", msg);
        return;
      }

      // ── 3. Open WS ──────────────────────────────────────────────────
      term.write("\x1b[90m  Opening PTY shell…\x1b[0m\r\n");
      const ws = new WebSocket(getPtyWsUrl(cols, rows));
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      // Timeout if WS never opens — stored in ref so cleanup can cancel it.
      // timedOut flag suppresses the subsequent onclose status update: when the
      // timeout fires and calls ws.close(), the browser emits onclose with a
      // generated code (1006) that would otherwise overwrite "error" with
      // "disconnected", producing a visible status flicker.
      let timedOut = false;
      wsTimeoutRef.current = setTimeout(() => {
        wsTimeoutRef.current = null;
        if (ws.readyState !== WebSocket.OPEN) {
          timedOut = true;
          const msg = `WebSocket did not connect within ${WS_CONNECT_TIMEOUT_MS / 1000}s`;
          onStatusChangeRef.current("error", msg);
          term.write(`\r\n\x1b[31m✗ ${msg}\x1b[0m\r\n`);
          console.error("[TerminalApp] WS connect timeout");
          ws.close();
        }
      }, WS_CONNECT_TIMEOUT_MS);

      ws.onopen = () => {
        clearTimeout(wsTimeoutRef.current ?? undefined);
        wsTimeoutRef.current = null;
        // DEF-1 fix: send auth token as first message (out-of-band, not in URL).
        // NOTE: token nulling was removed — rebinding a JS closure variable does
        // not zero heap memory and provides no actual security benefit.
        ws.send(JSON.stringify({ type: "auth", token }));
        console.log("[TerminalApp] WebSocket connected to PTY shell");
        // Status stays "connecting" until server confirms auth via "ready" message.
        // If auth is rejected, the server closes with code 4401 (handled in onclose).
      };

      ws.onmessage = (ev) => {
        try {
          // Guard against oversized frames before any allocation/parsing.
          // A malicious or buggy server could otherwise cause memory pressure or
          // UI lockup by sending arbitrarily large payloads.
          const raw = typeof ev.data === "string"
            ? ev.data
            : new TextDecoder().decode(ev.data as ArrayBuffer);
          if (raw.length > MAX_FRAME_BYTES) {
            console.warn(`[TerminalApp] Dropping oversized frame (${raw.length} bytes)`);
            return;
          }

          const msg = JSON.parse(raw) as {
            type: string;
            data?: string;
            code?: number;
            shell?: string;
            os?: string;
          };

          if (msg.type === "ready") {
            // Server confirms auth and reports shell/OS identity.
            onStatusChangeRef.current("connected");
            const shell = msg.shell ?? "shell";
            const os    = msg.os    ?? "unknown";
            onHandshakeRef.current?.({ shell, os });
            term.write(`\x1b[36m⬡ Gamma Agent Runtime\x1b[0m  \x1b[90mv2.0 · ${shell} · ${os}\x1b[0m\r\n`);
            term.focus();
          } else if (msg.type === "data" && msg.data) {
            term.write(msg.data);
          } else if (msg.type === "exit") {
            onStatusChangeRef.current("disconnected");
            term.write(`\r\n\x1b[33m[Shell exited with code ${msg.code ?? 0}]\x1b[0m\r\n`);
          }
        } catch { /* malformed frame — ignore */ }
      };

      ws.onerror = () => {
        clearTimeout(wsTimeoutRef.current ?? undefined);
        wsTimeoutRef.current = null;
        onStatusChangeRef.current("error", "WebSocket error");
        term.write("\r\n\x1b[31m[Connection error]\x1b[0m\r\n");
      };

      ws.onclose = (ev) => {
        // Cancel connect-timeout — socket is already closed, no point firing it
        clearTimeout(wsTimeoutRef.current ?? undefined);
        wsTimeoutRef.current = null;
        // If the timeout handler already set "error" and triggered this close,
        // suppress further status updates to prevent error→disconnected flicker.
        if (timedOut) return;
        // Custom close codes:
        //   4401 = auth rejected (invalid/expired token)
        //   4500 = PTY spawn failed
        if (ev.code === 4401) {
          onStatusChangeRef.current("error", "Authentication rejected by server");
          term.write("\r\n\x1b[31m[Auth rejected — token invalid or expired]\x1b[0m\r\n");
        } else if (ev.code === 4500) {
          onStatusChangeRef.current("error", "PTY spawn failed on server");
          term.write("\r\n\x1b[31m[PTY spawn failed — check server logs]\x1b[0m\r\n");
        } else if (ev.code !== 1000 && ev.code !== 1001) {
          onStatusChangeRef.current("disconnected");
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
  const [sessionKey, setSessionKey]   = useState(0);
  const [status, setStatus]           = useState<ConnStatus>("connecting");
  const [errorMsg, setErrorMsg]       = useState("");
  const [shellLabel, setShellLabel]   = useState("…");

  const handleStatusChange = useCallback((s: ConnStatus, msg?: string) => {
    setStatus(s);
    setErrorMsg(msg ?? "");
  }, []);

  const handleHandshake = useCallback(({ shell, os }: { shell: string; os: string }) => {
    setShellLabel(`${shell} · ${os}`);
  }, []);

  // Reconnect: bump key → TerminalSession unmounts + remounts fresh
  const reconnect = useCallback(() => {
    setStatus("connecting");
    setErrorMsg("");
    setShellLabel("…");
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
          <span style={{ color: "#333" }}>{shellLabel}</span>
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
                ((e.currentTarget as HTMLButtonElement).style.background = "#21262d")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.background = "#161b22")
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
        onHandshake={handleHandshake}
      />
    </div>
  );
}
