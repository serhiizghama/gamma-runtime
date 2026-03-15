import React, { useCallback, useEffect, useState } from "react";
import "../styles/os-theme.css";
import { useOSStore } from "../store/useOSStore";
import { BootScreen } from "./BootScreen";
import { Desktop } from "./Desktop";
import { Dock } from "./Dock";
import { Launchpad } from "./Launchpad";
import { MenuBar, MENU_HEIGHT } from "./MenuBar";
import { ArchitectWindow } from "./ArchitectWindow";
import { WindowManager } from "./WindowManager";
import { NotificationCenter } from "./NotificationCenter";
import { useSystemEvents } from "../hooks/useSystemEvents";
import { useAppRegistry } from "../hooks/useAppRegistry";

/**
 * Fresh-boot gate: spawn default windows ONLY when localStorage has no
 * existing session. Zustand persist hydrates synchronously from localStorage
 * before the first render, so by the time this effect runs, windows already
 * contains any saved state. An empty object means a genuine first boot.
 */
// ── Fresh boot defaults ──────────────────────────────────────────────────

function useFreshBootDefaults() {
  useEffect(() => {
    const { openWindow } = useOSStore.getState();
    const hasSession = !!localStorage.getItem("gamma-os-session");
    if (!hasSession) {
      openWindow("terminal", "Terminal");
      openWindow("browser",  "Browser");
    }
  }, []);
}

export function GammaOS(): React.ReactElement {
  const [booting, setBooting] = useState(true);
  const handleBootDone = useCallback(() => setBooting(false), []);
  const toggleArchitect = useOSStore((s) => s.toggleArchitect);
  const toggleLaunchpad = useOSStore((s) => s.toggleLaunchpad);

  useFreshBootDefaults();
  useAppRegistry(); // fetch registry + subscribe to component_ready/removed
  useSystemEvents(); // mock SSE → real EventSource in production

  if (booting) {
    return <BootScreen onDone={handleBootDone} />;
  }

  return (
    <div
      id="gamma-os"
      className="desktop-shell"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "linear-gradient(135deg, #0F172A 0%, #151F32 100%)",
        fontFamily: "var(--font-system)",
        color: "var(--color-text-primary)",
        userSelect: "none",
      }}
    >
      {/* Layer -1: Taskbar (top-anchored, glassmorphism) */}
      <MenuBar
        onOpenArchitect={toggleArchitect}
        onOpenLaunchpad={toggleLaunchpad}
      />

      {/* Layer 5: System Architect panel */}
      <ArchitectWindow />

      {/* Layer 0: Desktop background (offset by taskbar) */}
      <div style={{ flex: 1, minHeight: 0, position: "relative", paddingTop: MENU_HEIGHT }}>
        <Desktop />
      </div>

      {/* Layer 1: Windows */}
      <WindowManager />

      {/* Layer 2: Launchpad overlay */}
      <Launchpad />

      {/* Layer 3: Dock */}
      <Dock />

      {/* Layer 4: Notification toasts (top-right) */}
      <NotificationCenter />

      {/* Portal root for dropdowns / tooltips — spec §11 */}
      <div
        id="gamma-os-portal-root-inner"
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 9999,
        }}
      />
    </div>
  );
}
