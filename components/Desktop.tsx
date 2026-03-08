import React from "react";
import { useOSStore } from "../store/useOSStore";
import { MatrixBackground } from "./MatrixBackground";

/**
 * Desktop — background engine switcher.
 *
 * Renders either MatrixBackground or Live Nebula blobs depending on
 * uiSettings.backgroundType. CSS opacity transition provides a smooth
 * crossfade when switching engines.
 */
export function Desktop(): React.ReactElement {
  const launchpadOpen    = useOSStore((s) => s.launchpadOpen);
  const backgroundType   = useOSStore((s) => s.uiSettings.backgroundType);
  const { bgBlur, bgSpeed } = useOSStore((s) => s.uiSettings);

  const isMatrix = backgroundType === "matrix";

  return (
    <div
      className={launchpadOpen ? "desktop--launchpad-open" : undefined}
      style={{ position: "absolute", inset: 0, zIndex: 0 }}
    >
      {/* ── Matrix Rain ─────────────────────────────────────────── */}
      <div
        style={{
          position: "absolute", inset: 0,
          background: "#000",
          opacity: isMatrix ? 1 : 0,
          transition: "opacity 600ms ease",
          // Keep mounted to avoid re-creating the Canvas/RAF on every switch
          pointerEvents: isMatrix ? "auto" : "none",
        }}
      >
        <MatrixBackground />
      </div>

      {/* ── Live Nebula ─────────────────────────────────────────── */}
      <div
        style={{
          position: "absolute", inset: 0,
          opacity: isMatrix ? 0 : 1,
          transition: "opacity 600ms ease",
          pointerEvents: isMatrix ? "none" : "auto",
        }}
      >
        <div
          className="live-bg"
          style={{
            animationDuration: `${bgSpeed}s`,
          } as React.CSSProperties}
        >
          <div className="live-bg__blobs">
            {[1, 2, 3, 4, 5].map((n) => (
              <div
                key={n}
                className={`live-bg__blob live-bg__blob--${n}`}
                style={{ filter: `blur(${Math.round(bgBlur * (n < 4 ? 1 : 0.9))}px)` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
