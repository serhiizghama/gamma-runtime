import React from "react";
import { useOSStore } from "../store/useOSStore";

/**
 * Desktop — Live Nebula background + persistent "Gamma OS" brand watermark.
 */
export function Desktop(): React.ReactElement {
  const launchpadOpen       = useOSStore((s) => s.launchpadOpen);

  return (
    <div
      className={launchpadOpen ? "desktop--launchpad-open" : undefined}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 0,
        background: "var(--color-bg-base)",
      }}
    >
      {/* Persistent brand watermark — sits above nebula, below windows */}
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
        {/* Variant 1 logo: γ made of nodes + lines */}
        <svg
          viewBox="0 0 80 100"
          style={{
            width: "clamp(36px, 6vw, 80px)",
            height: "auto",
            opacity: 0.55,
            flexShrink: 0,
          }}
        >
          {/* Lines — Y-shape skeleton */}
          {[
            // Left arm: top-left → junction
            [[14, 8],  [24, 22], [34, 36], [40, 48]],
            // Right arm: top-right → junction
            [[66, 8],  [56, 22], [46, 36], [40, 48]],
            // Tail: junction → bottom
            [[40, 48], [40, 66], [40, 88]],
          ].map((arm, ai) =>
            arm.slice(0, -1).map((pt, i) => (
              <line
                key={`${ai}-${i}`}
                x1={pt[0]} y1={pt[1]}
                x2={arm[i + 1][0]} y2={arm[i + 1][1]}
                stroke="rgba(59, 130, 246, 0.4)"
                strokeWidth="1.2"
              />
            ))
          )}
          {/* Extra connecting lines for network feel */}
          <line x1="24" y1="22" x2="56" y2="22" stroke="rgba(59, 130, 246, 0.2)" strokeWidth="0.8" />
          <line x1="34" y1="36" x2="46" y2="36" stroke="rgba(59, 130, 246, 0.2)" strokeWidth="0.8" />

          {/* Nodes */}
          {[
            [14,  8, 2.2], [66,  8, 2.2],
            [24, 22, 1.6], [56, 22, 1.6],
            [34, 36, 1.4], [46, 36, 1.4],
            [40, 48, 2.6],  // junction — brightest
            [40, 66, 1.6],
            [40, 88, 2.0],
            // scatter nodes
            [8,  28, 1.0], [72, 28, 1.0],
            [18, 58, 0.9], [54, 72, 0.9],
          ].map(([cx, cy, r], i) => (
            <circle
              key={i}
              cx={cx} cy={cy} r={r}
              fill={i === 6 ? "rgba(59, 130, 246, 0.65)" : "rgba(96, 165, 250, 0.4)"}
            />
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
            WebkitTextStroke: "1px rgba(59, 130, 246, 0.25)",
            textShadow: "0 0 80px rgba(59, 130, 246, 0.15)",
            userSelect: "none",
            opacity: 0.7,
          }}
        >
          Gamma OS
        </span>
      </div>
    </div>
  );
}
