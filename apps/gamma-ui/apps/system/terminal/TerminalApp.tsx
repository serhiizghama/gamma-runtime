import React, { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { API_BASE } from "../../../constants/api";

// ─── WS URL ───────────────────────────────────────────────────────────────────

function getPtyWsUrl(token: string, cols: number, rows: number): string {
  // In the browser, use the current host (Vite proxies /pty → ws://localhost:3001/pty)
  const wsBase =
    typeof window !== "undefined"
      ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`
      : "ws://localhost:3001";
  return `${wsBase}/pty?token=${encodeURIComponent(token)}&cols=${cols}&rows=${rows}`;
}

// ─── Status badge ─────────────────────────────────────────────────────────────

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

// ─── TerminalApp ──────────────────────────────────────────────────────────────

export function TerminalApp(): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef      = useRef<Terminal | null>(null);
  const fitAddonRef  = useRef<FitAddon | null>(null);
  const wsRef        = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [errorMsg, setErrorMsg] = useState<string>("");

  // ── Cleanup helper ──────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onopen    = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror   = null;
      wsRef.current.onclose   = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  // ── Bootstrap: fetch token → open WS → attach xterm ───────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    // 1. Create xterm instance
    const term = new Terminal({
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.4,
      theme: {
        background:    "#0d1117",
        foreground:    "#e6edf3",
        cursor:        "#3fb950",
        cursorAccent:  "#0d1117",
        selectionBackground: "rgba(255,255,255,0.15)",
        black:   "#0d1117", red:     "#ff5f5f", green:   "#5fff87", yellow:  "#ffd787",
        blue:    "#5fd7ff", magenta: "#d787ff", cyan:    "#5fffff", white:   "#e6edf3",
        brightBlack: "#444",  brightRed:  "#ff8787", brightGreen:  "#87ffd7",
        brightYellow: "#ffffd7", brightBlue: "#87d7ff", brightMagenta: "#ffafff",
        brightCyan: "#87ffff", brightWhite: "#ffffff",
      },
      cursorBlink: true,
      scrollback: 5000,
      allowTransparency: false,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current    = term;
    fitAddonRef.current = fitAddon;

    const { cols, rows } = term;

    // 2. Request a one-time PTY auth token from the backend
    const controller = new AbortController();

    (async () => {
      let token: string;
      try {
        const res = await fetch(`${API_BASE}/api/pty/token`, {
          method: "POST",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Token request failed: HTTP ${res.status}`);
        const data = await res.json() as { token: string };
        token = data.token;
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        const msg = err instanceof Error ? err.message : String(err);
        setStatus("error");
        setErrorMsg(msg);
        term.write(`\r\n\x1b[31mFailed to obtain PTY token: ${msg}\x1b[0m\r\n`);
        return;
      }

      // 3. Open WebSocket
      const ws = new WebSocket(getPtyWsUrl(token, cols, rows));
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("connected");
        term.focus();
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(
            typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data)
          ) as { type: string; data?: string; code?: number };

          if (msg.type === "data" && typeof msg.data === "string") {
            term.write(msg.data);
          } else if (msg.type === "exit") {
            setStatus("disconnected");
            term.write(`\r\n\x1b[33m[Process exited with code ${msg.code ?? 0}]\x1b[0m\r\n`);
          }
        } catch { /* malformed frame — ignore */ }
      };

      ws.onerror = () => {
        setStatus("error");
        setErrorMsg("WebSocket connection error");
        term.write("\r\n\x1b[31m[WebSocket error — connection lost]\x1b[0m\r\n");
      };

      ws.onclose = (ev) => {
        if (ev.code !== 1000 && ev.code !== 1001) {
          setStatus("disconnected");
          term.write(`\r\n\x1b[33m[Disconnected (${ev.code})]\x1b[0m\r\n`);
        }
      };

      // 4. Forward user input → ws
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "data", data }));
        }
      });
    })();

    // 5. Resize observer — tell pty about terminal dimension changes
    const ro = new ResizeObserver(() => {
      if (!containerRef.current || !fitAddonRef.current || !termRef.current) return;
      try {
        fitAddonRef.current.fit();
        const { cols: c, rows: r } = termRef.current;
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "resize", cols: c, rows: r }));
        }
      } catch { /* ignore mid-unmount errors */ }
    });
    ro.observe(containerRef.current);

    return () => {
      controller.abort();
      ro.disconnect();
      cleanup();
      term.dispose();
      termRef.current     = null;
      fitAddonRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reconnect ───────────────────────────────────────────────────────────
  const reconnect = useCallback(() => {
    cleanup();
    termRef.current?.clear();
    setStatus("connecting");
    setErrorMsg("");
    // Re-run the effect by remounting; simplest approach is to bump a key from parent,
    // but here we reload the page or trigger via state. For now, page reload:
    window.location.reload();
  }, [cleanup]);

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
              boxShadow: status === "connected" ? `0 0 6px ${STATUS_COLOR[status]}` : "none",
            }}
          />
          <span style={{ color: STATUS_COLOR[status] }}>{STATUS_LABEL[status]}</span>
          {errorMsg && <span style={{ color: "#ff5f5f", marginLeft: 8 }}>— {errorMsg}</span>}
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ color: "#444" }}>zsh · macOS</span>
          {(status === "disconnected" || status === "error") && (
            <button
              onClick={reconnect}
              style={{
                background: "#21262d",
                border: "1px solid #30363d",
                borderRadius: 4,
                color: "#e6edf3",
                fontSize: 11,
                padding: "2px 8px",
                cursor: "pointer",
              }}
            >
              Reconnect
            </button>
          )}
        </div>
      </div>

      {/* ── xterm.js container ──────────────────────────────────────────── */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflow: "hidden",
          padding: "6px 4px 4px 6px",
        }}
      />
    </div>
  );
}
