import React, { useCallback, useEffect, useState } from "react";
import "../styles/os-theme.css";
import { useOSStore } from "../store/useOSStore";
import { BootScreen } from "./BootScreen";
import { Desktop } from "./Desktop";
import { Dock } from "./Dock";
import { Launchpad } from "./Launchpad";
import { WindowManager } from "./WindowManager";
import { NotificationCenter } from "./NotificationCenter";
import { useSystemEvents } from "../hooks/useSystemEvents";

/**
 * Fresh-boot gate: spawn default windows ONLY when localStorage has no
 * existing session. Zustand persist hydrates synchronously from localStorage
 * before the first render, so by the time this effect runs, windows already
 * contains any saved state. An empty object means a genuine first boot.
 */
function useFreshBootDefaults() {
  useEffect(() => {
    // persist middleware has already merged localStorage into the store
    // synchronously by this point — safe to read final hydrated state.
    const { openWindow } = useOSStore.getState();

    // Spawn defaults only if there is NO existing session in localStorage.
    // Empty windows after a session exists = user closed everything deliberately.
    const hasSession = !!localStorage.getItem("gamma-os-session");
    if (!hasSession) {
      openWindow("terminal", "Terminal");
      openWindow("browser",  "Browser");
    }
    // Run once on mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function GammaOS(): React.ReactElement {
  const [booting, setBooting] = useState(true);
  const handleBootDone = useCallback(() => setBooting(false), []);

  useFreshBootDefaults();
  useSystemEvents(); // mock SSE → real EventSource in production

  return (
    <>
      {booting && <BootScreen onDone={handleBootDone} />}
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
      {/* Layer 0: Desktop background */}
      <Desktop />

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
    </>
  );
}
