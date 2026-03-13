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
        background: "var(--color-bg-base)",
        color: "var(--color-text-primary)",
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
          borderBottom: "1px solid var(--color-border-subtle)",
          background: "var(--color-surface)",
        }}
      >
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: "999px",
            background: "var(--color-indicator-online-bg)",
            boxShadow: "var(--shadow-indicator-online)",
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
            border: "1px solid var(--color-border-subtle)",
            background: "var(--color-bg-primary)",
            padding: "7px 14px",
            color: "var(--color-text-primary)",
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
            background: "var(--button-primary-bg)",
            color: "var(--button-primary-fg)",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: "var(--shadow-button-primary)",
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
            style={{ flex: 1, border: "none", background: "var(--color-bg-base)" }}
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
                color: "var(--color-text-secondary)",
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

