import React from "react";
import { useGammaStore } from "../store/useGammaStore";

// ---------------------------------------------------------------------------
// Static Desktop — CSS radial gradients, zero JS animation, zero GPU drain.
// Replaces the 60fps Canvas aurora loop.
// ---------------------------------------------------------------------------

export function Desktop(): React.ReactElement {
  const launchpadOpen = useGammaStore((s) => s.launchpadOpen);

  return (
    <div
      className={launchpadOpen ? "desktop--launchpad-open" : undefined}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 0,
        background: `
          radial-gradient(ellipse 80% 50% at 20% 20%, hsla(230, 65%, 28%, 0.18) 0%, transparent 70%),
          radial-gradient(ellipse 60% 40% at 75% 30%, hsla(215, 72%, 30%, 0.15) 0%, transparent 65%),
          radial-gradient(ellipse 70% 50% at 50% 70%, hsla(235, 65%, 25%, 0.14) 0%, transparent 60%),
          radial-gradient(ellipse 50% 35% at 30% 85%, hsla(245, 60%, 22%, 0.12) 0%, transparent 55%),
          rgb(6, 8, 16)
        `,
      }}
    >
      {/* Brand watermark — above background, below windows */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
          zIndex: 1,
          gap: "clamp(16px, 2.5vw, 40px)",
        }}
      >
        <svg
          viewBox="0 0 80 100"
          style={{ width: "clamp(36px, 6vw, 80px)", height: "auto", opacity: 0.45, flexShrink: 0 }}
        >
          {[
            [[14, 8],  [24, 22], [34, 36], [40, 48]],
            [[66, 8],  [56, 22], [46, 36], [40, 48]],
            [[40, 48], [40, 66], [40, 88]],
          ].map((arm, ai) =>
            arm.slice(0, -1).map((pt, i) => (
              <line
                key={`${ai}-${i}`}
                x1={pt[0]} y1={pt[1]}
                x2={arm[i + 1][0]} y2={arm[i + 1][1]}
                stroke="rgba(59, 130, 246, 0.35)"
                strokeWidth="1.2"
              />
            ))
          )}
          <line x1="24" y1="22" x2="56" y2="22" stroke="rgba(59, 130, 246, 0.15)" strokeWidth="0.8" />
          <line x1="34" y1="36" x2="46" y2="36" stroke="rgba(59, 130, 246, 0.15)" strokeWidth="0.8" />
          {[
            [14,8,2.2],[66,8,2.2],[24,22,1.6],[56,22,1.6],
            [34,36,1.4],[46,36,1.4],[40,48,2.6],[40,66,1.6],[40,88,2.0],
            [8,28,1.0],[72,28,1.0],[18,58,0.9],[54,72,0.9],
          ].map(([cx, cy, r], i) => (
            <circle key={i} cx={cx} cy={cy} r={r}
              fill={i === 6 ? "rgba(59,130,246,0.6)" : "rgba(96,165,250,0.35)"} />
          ))}
        </svg>

        <span
          style={{
            fontSize: "clamp(48px, 8vw, 110px)",
            fontWeight: 900,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            fontFamily: "'SF Pro Display', -apple-system, sans-serif",
            color: "transparent",
            WebkitTextStroke: "1px rgba(59, 130, 246, 0.20)",
            textShadow: "0 0 80px rgba(59, 130, 246, 0.10)",
            userSelect: "none",
            opacity: 0.6,
          }}
        >
          Gamma
        </span>
      </div>
    </div>
  );
}
