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

/**
 * Fresh-boot gate: spawn default windows ONLY when localStorage has no
 * existing session. Zustand persist hydrates synchronously from localStorage
 * before the first render, so by the time this effect runs, windows already
 * contains any saved state. An empty object means a genuine first boot.
 */
import { API_BASE } from "../constants/api";

// ── Boot: ensure System Architect session exists ─────────────────────────

function useArchitectSession() {
  useEffect(() => {
    let cancelled = false;

    const ensureSession = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/sessions`);
        if (!res.ok) return;
        const sessions: { windowId: string }[] = await res.json();
        const exists = sessions.some((s) => s.windowId === "system-architect");
        if (!exists && !cancelled) {
          await fetch(`${API_BASE}/api/sessions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              windowId: "system-architect",
              appId: "system-architect",
              sessionKey: "system-architect",
              agentId: "architect",
            }),
          });
        }
      } catch {
        // Kernel not available yet — session will be created on next load
      }
    };

    ensureSession();
    return () => { cancelled = true; };
  }, []);
}

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
  useArchitectSession();
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
      {/* Layer -1: Menu Bar (fixed top) */}
      <MenuBar
        onOpenArchitect={toggleArchitect}
        onOpenLaunchpad={toggleLaunchpad}
      />

      {/* Layer 5: System Architect panel */}
      <ArchitectWindow />

      {/* Layer 0: Desktop background (offset by menu bar) */}
      <div style={{ paddingTop: MENU_HEIGHT }}>
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
    </>
  );
}
