import { useOSStore } from "../store/useOSStore";
import { useAgentStream } from "../hooks/useAgentStream";
import { AgentChat } from "./AgentChat";
import { MENU_HEIGHT } from "./MenuBar";

const ARCHITECT_WINDOW_ID = "system-architect";

/**
 * System Architect — a slide-in panel pinned to the right side.
 * Wired to the live SSE stream + POST /send endpoint.
 */
export function ArchitectWindow(): React.ReactElement | null {
  const architectOpen = useOSStore((s) => s.architectOpen);
  const toggleArchitect = useOSStore((s) => s.toggleArchitect);
  const { messages, status, pendingToolLines, sendMessage } =
    useAgentStream(ARCHITECT_WINDOW_ID);

  if (!architectOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: MENU_HEIGHT,
        right: 0,
        width: 420,
        height: `calc(100vh - ${MENU_HEIGHT}px)`,
        zIndex: 9998,
        display: "flex",
        flexDirection: "column",
        background: "#0a0a0a",
        borderLeft: "1px solid rgba(0, 255, 65, 0.12)",
        boxShadow: "-4px 0 24px rgba(0, 0, 0, 0.5)",
      }}
    >
      {/* Close / minimize button */}
      <button
        onClick={toggleArchitect}
        title="Minimize Architect"
        style={{
          position: "absolute",
          top: 8,
          right: 12,
          zIndex: 1,
          background: "transparent",
          border: "none",
          color: "#666",
          fontSize: 16,
          cursor: "pointer",
          padding: "2px 6px",
          borderRadius: 4,
          lineHeight: 1,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "#ccc";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "#666";
        }}
      >
        ✕
      </button>

      <AgentChat
        mode="live"
        title="System Architect"
        variant="fullWindow"
        accentColor="#00ff41"
        placeholder="Ask the Architect…"
        messages={messages}
        status={status}
        pendingToolLines={pendingToolLines}
        onSend={sendMessage}
      />
    </div>
  );
}
