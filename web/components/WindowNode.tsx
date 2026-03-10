import React, { useRef, useCallback, useEffect, lazy, Suspense } from "react";
import { useOSStore } from "../store/useOSStore";
import { TitleBar } from "./TitleBar";
import { ResizeHandles, ResizeEdge } from "./ResizeHandles";

// ── App registry — lazy-load per appId ──────────────────────────────────────
const TerminalApp       = lazy(() => import("../apps/TerminalApp").then((m)       => ({ default: m.TerminalApp  })));
const SettingsApp       = lazy(() => import("../apps/SettingsApp").then((m)       => ({ default: m.SettingsApp  })));
const KernelMonitorApp  = lazy(() => import("../apps/KernelMonitorApp").then((m)  => ({ default: m.KernelMonitorApp })));

function AppContent({ appId }: { appId: string }): React.ReactElement {
  const wrap = (node: React.ReactNode, label: string) => (
    <Suspense fallback={<AppPlaceholder label={`Loading ${label}…`} />}>
      {node}
    </Suspense>
  );
  switch (appId) {
    case "terminal":       return wrap(<TerminalApp />,       "Terminal");
    case "settings":       return wrap(<SettingsApp />,       "Settings");
    case "kernel-monitor": return wrap(<KernelMonitorApp />,  "Kernel Monitor");
    default:               return <AppPlaceholder label={appId} />;
  }
}

function AppPlaceholder({ label }: { label: string }): React.ReactElement {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text-secondary)",
        fontSize: 13,
        fontFamily: "var(--font-system)",
      }}
    >
      {label}
    </div>
  );
}

const MIN_W = 320;
const MIN_H = 200;

interface WindowNodeProps {
  id: string;
}

export function WindowNode({ id }: WindowNodeProps): React.ReactElement | null {
  const win = useOSStore((s) => s.windows[id]);
  const isFocused = useOSStore((s) => s.focusedWindowId === id);
  const focusWindow = useOSStore((s) => s.focusWindow);

  // Outer shell ref — only position/size CSS vars live here
  const shellRef = useRef<HTMLDivElement>(null);

  // Sync CSS vars from store (only after pointerup Zustand write)
  useEffect(() => {
    const el = shellRef.current;
    if (!el || !win) return;
    el.style.setProperty("--win-x", `${win.coordinates.x}px`);
    el.style.setProperty("--win-y", `${win.coordinates.y}px`);
    el.style.setProperty("--win-w", `${win.dimensions.width}px`);
    el.style.setProperty("--win-h", `${win.dimensions.height}px`);
  }, [win?.coordinates.x, win?.coordinates.y, win?.dimensions.width, win?.dimensions.height]);

  // ─── Drag ────────────────────────────────────────────────────────────────
  const handleDragStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      focusWindow(id);

      const el = shellRef.current;
      if (!el) return;

      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const initX = win?.coordinates.x ?? 0;
      const initY = win?.coordinates.y ?? 0;

      let currentX = initX;
      let currentY = initY;
      let rafPending = false;

      const onMove = (ev: PointerEvent) => {
        currentX = initX + (ev.clientX - startClientX);
        currentY = initY + (ev.clientY - startClientY);
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => {
          el.style.setProperty("--win-x", `${currentX}px`);
          el.style.setProperty("--win-y", `${currentY}px`);
          rafPending = false;
        });
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        el.style.setProperty("--win-x", `${currentX}px`);
        el.style.setProperty("--win-y", `${currentY}px`);
        useOSStore.getState().updateWindowPosition(id, { x: currentX, y: currentY });
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp, { once: true });
    },
    [id, win?.coordinates.x, win?.coordinates.y, focusWindow]
  );

  // ─── Resize ──────────────────────────────────────────────────────────────
  const onResizePointerDown = useCallback(
    (edge: ResizeEdge) => (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation(); // prevent drag from firing
      e.preventDefault();
      focusWindow(id);

      const el = shellRef.current;
      if (!el || !win) return;

      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const initW = win.dimensions.width;
      const initH = win.dimensions.height;
      const initX = win.coordinates.x;
      const initY = win.coordinates.y;

      let curW = initW;
      let curH = initH;
      let curX = initX;
      let curY = initY;
      let rafPending = false;

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startClientX;
        const dy = ev.clientY - startClientY;

        let newW = initW;
        let newH = initH;
        let newX = initX;
        let newY = initY;

        // East edge: widen rightward
        if (edge.includes("e")) newW = Math.max(MIN_W, initW + dx);
        // South edge: taller downward
        if (edge.includes("s")) newH = Math.max(MIN_H, initH + dy);
        // West edge: widen leftward, shift X
        if (edge.includes("w")) {
          newW = Math.max(MIN_W, initW - dx);
          newX = initX + (initW - newW); // keep right edge fixed
        }
        // North edge: taller upward, shift Y
        if (edge.includes("n")) {
          newH = Math.max(MIN_H, initH - dy);
          newY = initY + (initH - newH); // keep bottom edge fixed
        }

        curW = newW;
        curH = newH;
        curX = newX;
        curY = newY;

        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => {
          el.style.setProperty("--win-w", `${curW}px`);
          el.style.setProperty("--win-h", `${curH}px`);
          el.style.setProperty("--win-x", `${curX}px`);
          el.style.setProperty("--win-y", `${curY}px`);
          rafPending = false;
        });
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        // Flush final values to DOM
        el.style.setProperty("--win-w", `${curW}px`);
        el.style.setProperty("--win-h", `${curH}px`);
        el.style.setProperty("--win-x", `${curX}px`);
        el.style.setProperty("--win-y", `${curY}px`);
        // Single Zustand write
        useOSStore.getState().updateWindowDimensions(id, { width: curW, height: curH });
        useOSStore.getState().updateWindowPosition(id, { x: curX, y: curY });
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp, { once: true });
    },
    [id, win?.dimensions.width, win?.dimensions.height, win?.coordinates.x, win?.coordinates.y, focusWindow]
  );

  // ─── Focus on click ──────────────────────────────────────────────────────
  const handleShellPointerDown = useCallback(() => {
    if (!isFocused) focusWindow(id);
  }, [id, isFocused, focusWindow]);

  if (!win) return null;

  return (
    // Outer shell: position only — NO animation (animation overrides transform)
    <div
      ref={shellRef}
      className={`window${win.isMinimized ? " window--minimized" : ""}`}
      onPointerDown={handleShellPointerDown}
      style={{
        "--win-x": `${win.coordinates.x}px`,
        "--win-y": `${win.coordinates.y}px`,
        "--win-w": `${win.dimensions.width}px`,
        "--win-h": `${win.dimensions.height}px`,
        zIndex: win.zIndex,
      } as React.CSSProperties}
    >
      {/* Inner frame: visual styles + open animation */}
      <div
        className="window__frame"
        style={{
          background: "var(--window-bg)",
          backdropFilter: "var(--glass-blur)",
          WebkitBackdropFilter: "var(--glass-blur)",
          border: isFocused ? "1px solid #0066ff" : "var(--window-border)",
          boxShadow: isFocused
            ? "0 24px 60px rgba(15, 23, 42, 0.22)"
            : "var(--glass-shadow)",
          position: "relative", // so ResizeHandles can be absolute inside
        } as React.CSSProperties}
      >
        <TitleBar
          windowId={id}
          title={win.title}
          onDragStart={handleDragStart}
        />

        {/* App content — lazy-loaded per appId */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <AppContent appId={win.appId} />
        </div>

        {/* 8-directional resize handles */}
        <ResizeHandles onResizePointerDown={onResizePointerDown} />
      </div>
    </div>
  );
}
