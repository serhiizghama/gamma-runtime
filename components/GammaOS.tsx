import React from "react";
import "../styles/os-theme.css";
import { Desktop } from "./Desktop";
import { Dock } from "./Dock";

export function GammaOS(): React.ReactElement {
  return (
    <div
      id="gamma-os"
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        fontFamily: "var(--font-system)",
        color: "var(--text-primary)",
        userSelect: "none",
      }}
    >
      <Desktop />
      {/* WindowManager placeholder — Iteration 2 */}
      {/* Launchpad placeholder — Iteration 2 */}
      <Dock />
      {/* NotificationCenter placeholder — Iteration 3 */}
      {/* Portal root for floating UI — required by spec §11 Watch-out #1 */}
      <div id="gamma-os-portal-root" style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9999 }} />
    </div>
  );
}
