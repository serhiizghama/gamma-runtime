import React, { useState } from "react";

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // Treat bare domains as https URLs
  return `https://${trimmed}`;
}

export function BrowserApp(): React.ReactElement {
  const [input, setInput] = useState("https://gammaos.dev");
  const [url, setUrl] = useState<string | null>(normalizeUrl("https://gammaos.dev"));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = normalizeUrl(input);
    if (!next) return;
    setUrl(next);
  };

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: "radial-gradient(circle at top, #1b2845 0, #050712 45%, #020308 100%)",
        color: "var(--text-primary)",
        fontFamily: "var(--font-system)",
      }}
    >
      {/* Address bar */}
      <form
        onSubmit={handleSubmit}
        style={{
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          background: "linear-gradient(to bottom, rgba(10,10,18,0.9), rgba(5,7,15,0.95))",
        }}
      >
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: "999px",
            background: "radial-gradient(circle at 30% 30%, #4ade80, #16a34a)",
            boxShadow: "0 0 0 1px rgba(22,163,74,0.6)",
          }}
        />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Enter URL (e.g. docs.gammaos.dev)"
          spellCheck={false}
          style={{
            flex: 1,
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.15)",
            background: "rgba(5,10,20,0.9)",
            padding: "7px 14px",
            color: "var(--text-primary)",
            fontSize: 13,
            outline: "none",
          }}
        />
        <button
          type="submit"
          style={{
            borderRadius: 999,
            border: "none",
            padding: "7px 16px",
            background:
              "linear-gradient(135deg, rgba(56,189,248,0.95), rgba(129,140,248,0.95))",
            color: "#020617",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: "0 8px 18px rgba(59,130,246,0.35)",
          }}
        >
          Go
        </button>
      </form>

      {/* Content area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {url ? (
          <iframe
            src={url}
            title="Gamma Browser"
            style={{ flex: 1, border: "none", background: "#020617" }}
          />
        ) : (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: 32,
              textAlign: "center",
            }}
          >
            <h2 style={{ fontSize: 18, margin: 0 }}>Welcome to Gamma Browser</h2>
            <p
              style={{
                fontSize: 13,
                color: "var(--text-secondary)",
                maxWidth: 360,
                marginTop: 8,
              }}
            >
              Enter a URL above to open a site inside this window. This is a minimal shell
              meant to be extended by the Gamma OS Architect and AI agent.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

