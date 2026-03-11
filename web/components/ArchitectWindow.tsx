import { useRef, useCallback, useState } from "react";
import { useOSStore } from "../store/useOSStore";
import { useAgentStream } from "../hooks/useAgentStream";
import { AgentChat } from "./AgentChat";
import { MENU_HEIGHT } from "./MenuBar";

const ARCHITECT_WINDOW_ID = "system-architect";
const MIN_WIDTH = 300;
const MAX_WIDTH = 800;
const DEFAULT_WIDTH = 420;

/**
 * System Architect — a slide-in panel pinned to the right side.
 * Left-edge resizable. Wired to the live SSE stream + POST /send endpoint.
 */
export function ArchitectWindow(): React.ReactElement | null {
  const architectOpen = useOSStore((s) => s.architectOpen);
  const toggleArchitect = useOSStore((s) => s.toggleArchitect);
  const { messages, status, pendingToolLines, sendMessage } =
    useAgentStream(ARCHITECT_WINDOW_ID);

  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleResizeStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    startXRef.current = e.clientX;
    startWidthRef.current = width;
    el.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const deltaX = ev.clientX - startXRef.current;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidthRef.current - deltaX));
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => setWidth(newWidth));
    };

    const onUp = () => {
      el.releasePointerCapture(e.pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }, [width]);

  if (!architectOpen) return null;

  return (
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        top: MENU_HEIGHT,
        right: 0,
        width,
        height: `calc(100vh - ${MENU_HEIGHT}px)`,
        zIndex: 9998,
        display: "flex",
        flexDirection: "column",
        background: "var(--color-bg-secondary)",
        borderLeft: "1px solid var(--color-border-subtle)",
        boxShadow: "var(--shadow-panel-side)",
      }}
    >
      {/* Left-edge resize handle */}
      <div
        data-resize-handle
        onPointerDown={handleResizeStart}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 6,
          cursor: "ew-resize",
          zIndex: 10,
        }}
        aria-label="Resize panel"
        role="separator"
      />

      <AgentChat
        mode="live"
        title="System Architect"
        variant="fullWindow"
        accentColor="var(--color-accent-primary)"
        placeholder="Ask the Architect…"
        messages={messages}
        status={status}
        pendingToolLines={pendingToolLines}
        onSend={sendMessage}
        onClose={toggleArchitect}
      />
    </div>
  );
}
