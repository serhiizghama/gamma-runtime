import React, { useState, useEffect } from "react";

// ---------------------------------------------------------------------------
// Private-host detection
// ---------------------------------------------------------------------------

/**
 * Returns true if the given hostname (from URL.hostname) resolves to a
 * private, loopback, link-local, or documentation-only address.
 *
 * Covers:
 *  - "localhost"
 *  - IPv4: loopback (127/8), RFC-1918 (10/8, 172.16-31/12, 192.168/16),
 *           link-local (169.254/16)
 *  - IPv6: loopback (::1, full-form), ULA (fc00::/7), link-local (fe80::/10),
 *           IPv4-mapped (::ffff:…), documentation (2001:db8::/32),
 *           unspecified (::)
 */
function isPrivateHost(rawHostname: string): boolean {
  // URL.hostname wraps IPv6 literals in brackets; strip them.
  const host = rawHostname.startsWith("[")
    ? rawHostname.slice(1, -1)
    : rawHostname;

  if (host.toLowerCase() === "localhost") return true;

  // ── IPv4 ────────────────────────────────────────────────────────────────
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127) return true;                        // loopback
    if (a === 10) return true;                         // RFC-1918 class A
    if (a === 172 && b >= 16 && b <= 31) return true;  // RFC-1918 class B
    if (a === 192 && b === 168) return true;           // RFC-1918 class C
    if (a === 169 && b === 254) return true;           // link-local
    return false;
  }

  // ── IPv6 ────────────────────────────────────────────────────────────────
  const lower = host.toLowerCase();

  // Loopback: short form, full form
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") return true;
  // Unspecified
  if (lower === "::" || lower === "0:0:0:0:0:0:0:0") return true;
  // ULA  fc00::/7  → starts with fc or fd
  if (/^f[cd]/i.test(lower)) return true;
  // Link-local  fe80::/10  → starts with fe8, fe9, fea, feb
  if (/^fe[89ab]/i.test(lower)) return true;
  // Documentation  2001:db8::/32
  if (lower.startsWith("2001:db8:")) return true;

  // IPv4-mapped / IPv4-compatible  ::ffff:x.x.x.x  or  ::x.x.x.x
  // Pattern matches trailing dotted-quad in an otherwise all-zero IPv6 address.
  const v4mapped = lower.match(
    /^(?:[0:]*:)?(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/
  );
  if (v4mapped) {
    const parts = v4mapped[1].split(".").map(Number);
    const [a, b] = parts;
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// URL normalisation & validation
// ---------------------------------------------------------------------------

/**
 * Normalise a raw address-bar string into a validated https:// URL.
 * Returns null if the result fails any security check.
 */
function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Prepend https:// only when no scheme is present.
  const candidate = /^[a-z][a-z0-9+\-.]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  // Enforce https-only.
  if (parsed.protocol !== "https:") return null;

  // Block private / loopback hosts (SSRF guard).
  if (isPrivateHost(parsed.hostname)) return null;

  return parsed.href;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type FrameStatus = "idle" | "loading" | "loaded";

export function BrowserApp(): React.ReactElement {
  const [input, setInput] = useState("https://gammaruntime.dev");
  const [url, setUrl] = useState<string | null>(
    normalizeUrl("https://gammaruntime.dev")
  );
  const [urlError, setUrlError] = useState<string | null>(null);
  const [frameStatus, setFrameStatus] = useState<FrameStatus>("idle");

  // Keep address bar in sync if url is ever changed externally (e.g. props /
  // context injection in future iterations).
  useEffect(() => {
    if (url) setInput(url);
  }, [url]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = normalizeUrl(input);
    if (!next) {
      setUrlError("Only https:// URLs to public hosts are allowed.");
      return;
    }
    setUrlError(null);
    setFrameStatus("loading");
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
          flexDirection: "column",
          gap: 4,
          borderBottom: "1px solid var(--color-border-subtle)",
          background: "var(--color-surface)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Static lock — reflects https-only enforcement, not live TLS state */}
          <span
            aria-label="HTTPS only"
            role="img"
            style={{ fontSize: 14, lineHeight: 1, userSelect: "none" }}
          >
            🔒
          </span>
          <input
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (urlError) setUrlError(null);
            }}
            placeholder="Enter URL (https:// only)"
            spellCheck={false}
            style={{
              flex: 1,
              borderRadius: 999,
              border: urlError
                ? "1px solid var(--color-error, #e53e3e)"
                : "1px solid var(--color-border-subtle)",
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
        </div>
        {urlError && (
          <span
            role="alert"
            style={{
              fontSize: 11,
              color: "var(--color-error, #e53e3e)",
              paddingLeft: 26,
            }}
          >
            {urlError}
          </span>
        )}
      </form>

      {/* Content area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", position: "relative" }}>
        {url ? (
          <>
            {/* Loading indicator */}
            {frameStatus === "loading" && (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 2,
                  background: "var(--color-accent, #6366f1)",
                  animation: "pulse 1s ease-in-out infinite",
                  zIndex: 10,
                }}
              />
            )}

            <iframe
              key={url}
              src={url}
              title="Gamma Browser"
              /*
               * Security notes:
               *
               * allow-same-origin is intentionally omitted. Combining
               * allow-scripts + allow-same-origin lets the framed page access
               * the parent's origin, cookies, and localStorage, fully negating
               * sandboxing. Without it the iframe runs under an opaque origin.
               *
               * allow-popups is intentionally omitted. Popups opened via
               * window.open() are NOT sandboxed; they inherit the full browser
               * context and can interact with the host environment. Remove this
               * comment block and restore allow-popups only after explicit
               * product review and documented justification.
               *
               * allow-forms is retained: form submissions cannot navigate the
               * top frame without allow-top-navigation, so the risk is bounded.
               */
              sandbox="allow-scripts allow-forms"
              referrerPolicy="no-referrer"
              onLoad={() => setFrameStatus("loaded")}
              style={{
                flex: 1,
                border: "none",
                background: "var(--color-bg-base)",
                display: "block",
                width: "100%",
                height: "100%",
              }}
            />

            {/* Framing-blocked fallback hint.
                Many sites set X-Frame-Options or CSP frame-ancestors, which
                causes a silent blank iframe. We cannot detect this reliably
                without same-origin access, so we surface a persistent hint. */}
            {frameStatus === "loaded" && (
              <div
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  padding: "6px 14px",
                  background: "var(--color-surface, rgba(0,0,0,0.6))",
                  borderTop: "1px solid var(--color-border-subtle)",
                  fontSize: 11,
                  color: "var(--color-text-secondary)",
                  textAlign: "center",
                  pointerEvents: "none",
                }}
              >
                If this page appears blank, the site may not allow embedding in
                frames.
              </div>
            )}
          </>
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
              Enter a URL above to open a site inside this window. Only public
              https:// addresses are accepted. This is a minimal shell meant to
              be extended by the Gamma Agent Runtime Architect and AI agent.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
