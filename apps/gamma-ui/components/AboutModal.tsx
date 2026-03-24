import React, { useEffect } from "react";

// ── Build-time constants (update on each deploy) ─────────────────────────
const BUILD = {
  appName:    "Gamma Agent Runtime",
  version:    "0.1.0",
  commit:     "ee47b09",
  commitFull: "ee47b09a1611408f7dc7e348066ebe4248381382",
  branch:     "main",
  lastCommit: "refactor: rebrand from Gamma OS to Gamma Agent Runtime",
  commitDate: "2026-03-13",
  react:      "18.3.1",
  vite:       "5.3.4",
  node:       "22.22.0",
  os:         "macOS 15.3.1 Sequoia",
  arch:       "arm64",
};

// ── Helpers ───────────────────────────────────────────────────────────────

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
      <span style={{ color: "rgba(180,200,255,0.45)", fontSize: 11, whiteSpace: "nowrap" }}>
        {label}
      </span>
      <span
        style={{
          color: "rgba(220,235,255,0.85)",
          fontSize: 11,
          fontFamily: mono ? "'SF Mono', 'Fira Code', monospace" : "inherit",
          textAlign: "right",
          wordBreak: "break-all",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return (
    <div
      style={{
        height: 1,
        background: "rgba(255,255,255,0.06)",
        margin: "10px 0",
      }}
    />
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

export function AboutModal({ onClose }: Props): React.ReactElement {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    // Backdrop
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "flex-start",
        padding: "40px 0 0 12px",
      }}
    >
      {/* Panel — stop propagation so clicking inside doesn't close */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 310,
          background: "rgba(10, 14, 28, 0.82)",
          backdropFilter: "none",
          WebkitBackdropFilter: "none",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 14,
          boxShadow: "0 24px 64px rgba(0,0,0,0.7), 0 0 0 0.5px rgba(255,255,255,0.04) inset",
          padding: "24px 22px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 0,
          animation: "aboutFadeIn 0.15s ease-out",
          fontFamily: "'SF Pro Text', -apple-system, BlinkMacSystemFont, sans-serif",
        }}
      >
        {/* Header: logo + name */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
          <svg viewBox="0 0 40 48" width="38" height="46" style={{ flexShrink: 0 }}>
            {/* Gamma γ shape */}
            <path
              d="M4 6 L20 26 L20 44 M36 6 L20 26"
              stroke="rgba(59,130,246,0.85)"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            {/* Glow dots */}
            {[[4,6],[36,6],[20,26],[20,44]].map(([cx,cy],i) => (
              <circle key={i} cx={cx} cy={cy} r={i===2?3.5:2.2}
                fill={i===2 ? "rgba(96,165,250,0.9)" : "rgba(96,165,250,0.5)"} />
            ))}
          </svg>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "rgba(230,240,255,0.95)", letterSpacing: 0.3 }}>
              {BUILD.appName}
            </div>
            <div style={{ fontSize: 11, color: "rgba(150,180,255,0.5)", marginTop: 2 }}>
              Version {BUILD.version}
            </div>
          </div>
        </div>

        {/* Runtime */}
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <Row label="Version"   value={BUILD.version} />
          <Row label="Branch"    value={BUILD.branch}  mono />
          <Row label="Commit"    value={BUILD.commit}  mono />
          <Row label="Message"   value={BUILD.lastCommit} />
          <Row label="Date"      value={BUILD.commitDate} />
        </div>

        <Divider />

        {/* Stack */}
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <Row label="React"  value={BUILD.react}  mono />
          <Row label="Vite"   value={BUILD.vite}   mono />
          <Row label="Node"   value={BUILD.node}   mono />
        </div>

        <Divider />

        {/* Host */}
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <Row label="Host OS"  value={BUILD.os}   />
          <Row label="Arch"     value={BUILD.arch} mono />
        </div>

        {/* Close hint */}
        <div
          style={{
            marginTop: 18,
            textAlign: "center",
            fontSize: 10,
            color: "rgba(255,255,255,0.18)",
          }}
        >
          click outside or press Esc to close
        </div>
      </div>

      {/* Keyframe animation injected once */}
      <style>{`
        @keyframes aboutFadeIn {
          from { opacity: 0; transform: translateY(-6px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)   scale(1);    }
        }
      `}</style>
    </div>
  );
}
