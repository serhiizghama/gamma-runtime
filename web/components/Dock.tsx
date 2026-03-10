import React from "react";
import { useOSStore } from "../store/useOSStore";
import { AppIcon } from "./AppIcon";

export function Dock(): React.ReactElement {
  const toggleLaunchpad = useOSStore((s) => s.toggleLaunchpad);
  const launchpadOpen   = useOSStore((s) => s.launchpadOpen);
  const focusWindow     = useOSStore((s) => s.focusWindow);

  const minimizedWindows = useOSStore((s) =>
    Object.values(s.windows).filter((w) => w.isMinimized)
  );

  return (
    <div
      style={{
        position: "fixed",
        bottom: 12,
        left: "50%",
        transform: "translateX(-50%)",
        background: "var(--dock-bg)",
        backdropFilter: "var(--dock-blur)",
        WebkitBackdropFilter: "var(--dock-blur)",
        borderRadius: "var(--dock-radius)",
        padding: "var(--dock-padding)",
        display: "flex",
        alignItems: "flex-end",
        gap: 4,
        minHeight: 80,
        zIndex: 1000,
        border: "1px solid rgba(255,255,255,0.38)",
        boxShadow: "0 8px 40px rgba(80,60,120,0.18), inset 0 1px 0 rgba(255,255,255,0.5)",
      }}
    >
      {/* Launchpad toggle */}
      <AppIcon
        icon={launchpadOpen ? "✦" : "⊞"}
        label="Apps"
        variant="dock"
        onClick={toggleLaunchpad}
        title="Launchpad"
      />

      {minimizedWindows.length > 0 && (
        <div
          style={{
            width: 1,
            height: 40,
            background: "rgba(255,255,255,0.35)",
            margin: "0 4px 8px",
            flexShrink: 0,
            alignSelf: "center",
          }}
        />
      )}

      {minimizedWindows.map((win) => (
        <AppIcon
          key={win.id}
          icon="🗗"
          label={win.title}
          variant="dock"
          onClick={() => focusWindow(win.id)}
          title={`Restore ${win.title}`}
        />
      ))}
    </div>
  );
}
