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
    <div className="dock-trigger-area">
      <div className="dock-container">
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
    </div>
  );
}
