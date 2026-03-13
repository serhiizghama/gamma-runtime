import React, {
  useRef,
  useCallback,
  useEffect,
  Suspense,
  useState,
} from "react";
import { useOSStore } from "../store/useOSStore";
import { TitleBar } from "./TitleBar";
import { ResizeHandles, ResizeEdge } from "./ResizeHandles";
import { DynamicAppRenderer } from "./DynamicAppRenderer";
import { AgentChat } from "./AgentChat";
import { useAgentStream } from "../hooks/useAgentStream";
import { API_BASE } from "../constants/api";
import { getSystemApp } from "../registry/systemApps";

function EmbeddedAgentChat({
  appId,
  title,
  onClose,
}: {
  appId: string;
  title: string;
  onClose: () => void;
}): React.ReactElement {
  const sessionKey = `app-owner-${appId}`;
  // TODO (Stage 4): Context Injection for specific apps is currently bypassed.
  // The backend successfully reads the app's context.md, but OpenClaw session
  // initialization requires a refactor to properly ingest the custom
  // system_prompt. The embedded chat currently falls back to the default
  // Gamma OS Assistant persona, even when using app-owner session keys.
  const { messages, status, pendingToolLines, sendMessage } =
    useAgentStream(sessionKey);
  return (
    <AgentChat
      mode="live"
      title={`${title} Assistant`}
      variant="embedded"
      placeholder={`Ask about ${title}…`}
      messages={messages}
      status={status}
      pendingToolLines={pendingToolLines}
      onSend={sendMessage}
      onClose={onClose}
    />
  );
}

function AppContent({
  appId,
  registryEntry,
}: {
  appId: string;
  registryEntry?: import("@gamma/types").AppRegistryEntry | null;
}): React.ReactElement {
  const wrap = (node: React.ReactNode, label: string) => (
    <Suspense fallback={<AppPlaceholder label={`Loading ${label}…`} />}>
      {node}
    </Suspense>
  );
  if (registryEntry) {
    return <DynamicAppRenderer appId={appId} entry={registryEntry} />;
  }
  const SystemApp = getSystemApp(appId);
  if (SystemApp) {
    return wrap(<SystemApp />, appId);
  }
  return <AppPlaceholder label={appId} />;
}

function AppPlaceholder({ label }: { label: string }): React.ReactElement {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--color-text-secondary)",
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
const AGENT_PANEL_MIN = 0.2;
const AGENT_PANEL_MAX = 0.9;
const AGENT_PANEL_DEFAULT = 0.4;

interface WindowNodeProps {
  id: string;
}

export function WindowNode({ id }: WindowNodeProps): React.ReactElement | null {
  const win = useOSStore((s) => s.windows[id]);
  const isFocused = useOSStore((s) => s.focusedWindowId === id);
  const focusWindow = useOSStore((s) => s.focusWindow);
  const appRegistry = useOSStore((s) => s.appRegistry);
  const windowAgentPanelOpen = useOSStore((s) => s.windowAgentPanelOpen);
  const toggleWindowAgentPanel = useOSStore((s) => s.toggleWindowAgentPanel);

  const registryEntry = win ? appRegistry[win.appId] : null;
  const hasAgent = registryEntry?.hasAgent ?? false;
  const agentPanelOpen = windowAgentPanelOpen[id] ?? false;

  const [agentPanelHeight, setAgentPanelHeight] = useState(AGENT_PANEL_DEFAULT);
  const panelResizeRef = useRef({ startY: 0, startHeight: 0 });

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

  // ─── AI Assistant toggle: create session on first open, then toggle panel ──
  const handleToggleAgent = useCallback(async () => {
    if (!win) return;
    if (!win.appId || win.appId === "undefined") {
      return;
    }
    const sessionWindowId = `app-owner-${win.appId}`;
    if (!agentPanelOpen) {
      try {
        const res = await fetch(`${API_BASE}/api/sessions`);
        if (!res.ok) return;
        const sessions: { windowId: string }[] = await res.json();
        const exists = sessions.some((s) => s.windowId === sessionWindowId);
        if (!exists) {
          await fetch(`${API_BASE}/api/sessions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              windowId: sessionWindowId,
              appId: win.appId,
              sessionKey: sessionWindowId,
              agentId: "app-owner",
            }),
          });
        }
      } catch {
        /* Kernel may not be running */
      }
    }
    toggleWindowAgentPanel(id);
  }, [id, win, agentPanelOpen, toggleWindowAgentPanel]);

  // ─── Agent panel top-edge resize (drag handle) ────────────────────────────
  const onPanelResizeDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const el = e.currentTarget;
      panelResizeRef.current = { startY: e.clientY, startHeight: agentPanelHeight };
      el.setPointerCapture(e.pointerId);
      const onMove = (ev: PointerEvent) => {
        const frame = el.closest(".window__frame") as HTMLElement;
        if (!frame) return;
        const frameH = frame.offsetHeight;
        const dy = ev.clientY - panelResizeRef.current.startY;
        const deltaFrac = -dy / frameH;
        let newHeight = panelResizeRef.current.startHeight + deltaFrac;
        newHeight = Math.max(AGENT_PANEL_MIN, Math.min(AGENT_PANEL_MAX, newHeight));
        setAgentPanelHeight(newHeight);
      };
      const onUp = () => {
        el.releasePointerCapture(e.pointerId);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp, { once: true });
    },
    [agentPanelHeight],
  );

  if (!win) return null;

  return (
    // Outer shell: position only — NO animation (animation overrides transform)
    <div
      ref={shellRef}
      className={`window${win.isMinimized ? " window--minimized" : ""}${
        win.isMaximized ? " window--maximized" : ""
      }${isFocused ? " window--focused" : ""}`}
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
          position: "relative", // so ResizeHandles can be absolute inside
        } as React.CSSProperties}
      >
        <TitleBar
          windowId={id}
          title={win.title}
          onDragStart={handleDragStart}
          hasAgent={hasAgent}
          agentPanelOpen={agentPanelOpen}
          onToggleAgent={handleToggleAgent}
        />

        {/* App content + optional Agent chat panel */}
        <div
          style={{
            flex: 1,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            position: "relative",
            zIndex: 1,
          }}
        >
          {/* App content — full height; panel overlays from bottom when open */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <AppContent appId={win.appId} registryEntry={registryEntry} />
          </div>

          {/* Embedded AgentChat — absolutely anchored to bottom, overlays app content */}
          {agentPanelOpen && (
            <div
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                height: `${agentPanelHeight * 100}%`,
                minHeight: 120,
                display: "flex",
                flexDirection: "column",
                zIndex: 50,
                background: "var(--color-bg-secondary)",
                borderTop: "2px solid var(--color-border-subtle)",
                borderRadius: "8px 8px 0 0",
                boxShadow: "var(--shadow-panel-overlay)",
              }}
            >
              {/* Resize handle (top edge of panel) */}
              <div
                onPointerDown={onPanelResizeDown}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 8,
                  cursor: "ns-resize",
                  zIndex: 5,
                  background: "transparent",
                }}
                aria-label="Resize chat panel"
                role="separator"
              />
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <EmbeddedAgentChat appId={win.appId} title={win.title} onClose={() => toggleWindowAgentPanel(id)} />
              </div>
            </div>
          )}
        </div>

        {/* 8-directional resize handles */}
        <ResizeHandles onResizePointerDown={onResizePointerDown} />
      </div>
    </div>
  );
}
