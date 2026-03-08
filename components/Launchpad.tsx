import React, { useEffect, useCallback } from "react";
import { useOSStore } from "../store/useOSStore";
import { INSTALLED_APPS } from "../constants/apps";

export function Launchpad(): React.ReactElement {
  const launchpadOpen = useOSStore((s) => s.launchpadOpen);
  const closeLaunchpad = useOSStore((s) => s.closeLaunchpad);
  const openWindow = useOSStore((s) => s.openWindow);

  const handleAppClick = useCallback(
    (appId: string, appName: string) => {
      openWindow(appId, appName);
      closeLaunchpad();
    },
    [openWindow, closeLaunchpad]
  );

  // Close on Escape
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
      onClick={closeLaunchpad} // click outside grid closes launchpad
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 500,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.45)",
        backdropFilter: launchpadOpen ? "blur(24px) brightness(0.75)" : "none",
        WebkitBackdropFilter: launchpadOpen ? "blur(24px) brightness(0.75)" : "none",
        opacity: launchpadOpen ? 1 : 0,
        pointerEvents: launchpadOpen ? "auto" : "none",
        transition: "opacity 280ms cubic-bezier(0.25,0.46,0.45,0.94)",
      }}
    >
      {/* Grid — stop propagation so clicking inside doesn't close */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 32,
          padding: 48,
          maxWidth: 600,
        }}
      >
        {INSTALLED_APPS.map((app) => (
          <button
            key={app.id}
            onClick={() => handleAppClick(app.id, app.name)}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "12px 8px",
              borderRadius: 16,
              transition: "background 180ms ease",
              color: "var(--text-primary)",
              fontFamily: "var(--font-system)",
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background =
                "rgba(255,255,255,0.12)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background =
                "transparent")
            }
          >
            <span
              style={{
                fontSize: 52,
                lineHeight: 1,
                filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.5))",
              }}
            >
              {app.icon}
            </span>
            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)" }}>
              {app.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
