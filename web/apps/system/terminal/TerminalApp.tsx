import React, { useEffect, useRef, useState } from "react";

interface TerminalLine {
  text: string;
  ts: number;
}

/**
 * TerminalApp — built-in demo terminal.
 *
 * This is NOT a real shell. It is a self-contained UI process that:
 * - Appends a heartbeat line every 2s
 * - Echoes user input and prints a faux "command not found"
 * - Demonstrates the mandatory cleanup contract for long-running effects
 */
export function TerminalApp(): React.ReactElement {
  const [lines, setLines] = useState<TerminalLine[]>([
    { text: "Gamma OS Terminal v1.0", ts: Date.now() },
    { text: "Type anything. Heartbeat fires every 2s.", ts: Date.now() },
  ]);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // ── Cleanup contract ────────────────────────────────────────────────────
  useEffect(() => {
    console.log("[Gamma OS] Terminal process started");

    const id = setInterval(() => {
      console.log("[Gamma OS] Terminal heartbeat");
      setLines((prev) => [
        ...prev,
        { text: `$ heartbeat @ ${new Date().toLocaleTimeString()}`, ts: Date.now() },
      ]);
    }, 2000);

    return () => {
      clearInterval(id);
      console.log("[Gamma OS] Terminal process killed");
    };
  }, []);

  // Auto-scroll to bottom on new lines
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    setLines((prev) => [
      ...prev,
      { text: `$ ${input}`, ts: Date.now() },
      { text: `command not found: ${input}`, ts: Date.now() },
    ]);
    setInput("");
  };

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: "rgba(0,0,0,0.85)",
        fontFamily: "'SF Mono', 'Fira Code', 'Menlo', monospace",
        fontSize: 12,
        color: "#e2e2e2",
        overflow: "hidden",
      }}
    >
      {/* Output */}
      <div style={{ flex: 1, overflow: "auto", padding: "12px 14px" }}>
        {lines.map((l, i) => (
          <div key={i} style={{ lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {l.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          alignItems: "center",
          padding: "6px 14px",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          gap: 8,
        }}
      >
        <span style={{ color: "#28c840", flexShrink: 0 }}>▸</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "#e2e2e2",
            fontFamily: "inherit",
            fontSize: 12,
          }}
          placeholder="enter command..."
          autoFocus
          spellCheck={false}
        />
      </form>
    </div>
  );
}

