import React, { useCallback, useEffect, useState } from "react";
import "../styles/os-theme.css";
import { useGammaStore } from "../store/useGammaStore";
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
import { API_BASE } from "../constants/api";
import { systemAuthHeaders } from "../lib/auth";

/**
 * Fresh-boot gate: spawn default windows ONLY when localStorage has no
 * existing session. Zustand persist hydrates synchronously from localStorage
 * before the first render, so by the time this effect runs, windows already
 * contains any saved state. An empty object means a genuine first boot.
 */
// ── Fresh boot defaults ──────────────────────────────────────────────────

function useFreshBootDefaults() {
  useEffect(() => {
    const { openWindow } = useGammaStore.getState();
    const hasSession = !!localStorage.getItem("gamma-session");
    if (!hasSession) {
      openWindow("terminal", "Terminal");
      openWindow("browser",  "Browser");
    }
  }, []);
}

/**
 * Abort all running sessions on page unload (tab close / navigation away).
 * Uses navigator.sendBeacon for fire-and-forget reliability on unload.
 * Also aborts on visibility hidden → visible after a long gap (tab sleep).
 */
function useSessionCleanupOnUnload(): void {
  useEffect(() => {
    const abortAll = () => {
      const url = `${API_BASE}/api/sessions/abort-all`;
      const headers = systemAuthHeaders();
      // sendBeacon doesn't support custom headers — use fetch with keepalive
      // keepalive ensures the request completes even after the page unloads
      fetch(url, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "page_unload" }),
        keepalive: true,
      }).catch(() => { /* best-effort */ });
    };

    const handleUnload = () => abortAll();
    const handleVisibility = () => {
      // When tab comes back after being hidden for > 30s, treat it as a reconnect
      // but don't abort — just let the SSE reconnect naturally
    };

    window.addEventListener("beforeunload", handleUnload);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("beforeunload", handleUnload);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);
}

export function Gamma(): React.ReactElement {
  const [booting, setBooting] = useState(true);
  const handleBootDone = useCallback(() => setBooting(false), []);
  const toggleArchitect = useGammaStore((s) => s.toggleArchitect);
  const toggleLaunchpad = useGammaStore((s) => s.toggleLaunchpad);

  useFreshBootDefaults();
  useAppRegistry(); // fetch registry + subscribe to component_ready/removed
  useSystemEvents(); // mock SSE → real EventSource in production
  useSessionCleanupOnUnload(); // abort running sessions on tab close

  if (booting) {
    return <BootScreen onDone={handleBootDone} />;
  }

  return (
    <div
      id="gamma-runtime"
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
        id="gamma-portal-root-inner"
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
