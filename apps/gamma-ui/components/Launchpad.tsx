import React, { useEffect, useCallback } from "react";
import { useGammaStore } from "../store/useGammaStore";
import { INSTALLED_APPS } from "../constants/apps";
import { AppIcon } from "./AppIcon";

export function Launchpad(): React.ReactElement {
  const launchpadOpen = useGammaStore((s) => s.launchpadOpen);
  const closeLaunchpad = useGammaStore((s) => s.closeLaunchpad);
  const openWindow = useGammaStore((s) => s.openWindow);

  const handleAppClick = useCallback(
    (appId: string, appName: string) => {
      openWindow(appId, appName);
      closeLaunchpad();
    },
    [openWindow, closeLaunchpad]
  );

  useEffect(() => {
    if (!launchpadOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLaunchpad();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [launchpadOpen, closeLaunchpad]);

  return (
    <div
      onClick={closeLaunchpad}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 500,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(60, 40, 100, 0.35)",
        backdropFilter: launchpadOpen ? "blur(32px) saturate(160%)" : "none",
        WebkitBackdropFilter: launchpadOpen ? "blur(32px) saturate(160%)" : "none",
        opacity: launchpadOpen ? 1 : 0,
        pointerEvents: launchpadOpen ? "auto" : "none",
        transition: "opacity 300ms var(--ease-smooth)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 90px)",
          gap: 16,
          padding: 40,
        }}
      >
        {INSTALLED_APPS.map((app) => (
          <AppIcon
            key={app.id}
            icon={app.icon}
            label={app.name}
            variant="launchpad"
            onClick={() => handleAppClick(app.id, app.name)}
          />
        ))}
      </div>
    </div>
  );
}
