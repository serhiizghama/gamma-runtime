import React, { useRef, useCallback, useEffect } from "react";
import { useOSStore } from "../store/useOSStore";
import { TitleBar } from "./TitleBar";

interface WindowNodeProps {
  id: string;
}

export function WindowNode({ id }: WindowNodeProps): React.ReactElement | null {
  const win = useOSStore((s) => s.windows[id]);
  const isFocused = useOSStore((s) => s.focusedWindowId === id);
  const focusWindow = useOSStore((s) => s.focusWindow);

  // Local ref for DOM node — CSS vars driven during motion
  const nodeRef = useRef<HTMLDivElement>(null);

  // Sync CSS vars from store on mount and when store coords/dims change
  // (they only change on pointerup write-back — safe to sync here)
  useEffect(() => {
    const el = nodeRef.current;
    if (!el || !win) return;
    el.style.setProperty("--win-x", `${win.coordinates.x}px`);
    el.style.setProperty("--win-y", `${win.coordinates.y}px`);
    el.style.setProperty("--win-w", `${win.dimensions.width}px`);
    el.style.setProperty("--win-h", `${win.dimensions.height}px`);
  }, [win?.coordinates.x, win?.coordinates.y, win?.dimensions.width, win?.dimensions.height]);

  const handleTitleBarPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();

      // Focus on drag start
      focusWindow(id);

      const el = nodeRef.current;
      if (!el) return;

      // Capture current CSS var values as drag origin
      const startX = e.clientX;
      const startY = e.clientY;
      const initX = win?.coordinates.x ?? 0;
      const initY = win?.coordinates.y ?? 0;

      let currentX = initX;
      let currentY = initY;
      let rafId: number | null = null;

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        currentX = initX + dx;
        currentY = initY + dy;

        if (rafId !== null) return; // already scheduled
        rafId = requestAnimationFrame(() => {
          el.style.setProperty("--win-x", `${currentX}px`);
          el.style.setProperty("--win-y", `${currentY}px`);
          rafId = null;
        });
      };

      const onUp = () => {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          // Apply final position synchronously
          el.style.setProperty("--win-x", `${currentX}px`);
          el.style.setProperty("--win-y", `${currentY}px`);
        }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        // Single Zustand write
        useOSStore.getState().updateWindowPosition(id, { x: currentX, y: currentY });
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp, { once: true });
    },
    [id, win?.coordinates.x, win?.coordinates.y, focusWindow]
  );

  const handleWindowPointerDown = useCallback(() => {
    if (!isFocused) focusWindow(id);
  }, [id, isFocused, focusWindow]);

  if (!win) return null;

  return (
    <div
      ref={nodeRef}
      className={`window${win.isMinimized ? " window--minimized" : ""}${isFocused ? " window--focused" : ""}`}
      onPointerDown={handleWindowPointerDown}
      style={{
        // CSS vars set via useEffect and RAF — these are the initial values only
        "--win-x": `${win.coordinates.x}px`,
        "--win-y": `${win.coordinates.y}px`,
        "--win-w": `${win.dimensions.width}px`,
        "--win-h": `${win.dimensions.height}px`,
        zIndex: win.zIndex,
        background: "var(--window-bg)",
        backdropFilter: "var(--glass-blur)",
        WebkitBackdropFilter: "var(--glass-blur)",
        border: isFocused ? "1px solid rgba(255,255,255,0.12)" : "var(--window-border)",
        borderRadius: "var(--window-radius)",
        boxShadow: isFocused
          ? "0 32px 80px rgba(0,0,0,0.72)"
          : "var(--glass-shadow)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        minWidth: "var(--window-min-width)",
        minHeight: "var(--window-min-height)",
        // Remove animation on minimized restore
        animation: win.isMinimized ? "none" : undefined,
      } as React.CSSProperties}
    >
      <TitleBar
        windowId={id}
        title={win.title}
        onPointerDown={handleTitleBarPointerDown}
      />

      {/* AppContent placeholder — Iteration 4 */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-secondary)",
          fontSize: 13,
          fontFamily: "var(--font-system)",
        }}
      >
        {win.appId}
      </div>
    </div>
  );
}
