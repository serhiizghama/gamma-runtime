import type { AgentStatus } from "@gamma/types";

interface ChatHeaderProps {
  title: string;
  status: AgentStatus;
  accentColor: string;
}

const STATUS_CONFIG: Record<AgentStatus, { label: string; color: string }> = {
  idle: { label: "Idle", color: "#d1d5db" },
  running: { label: "Thinking…", color: "#0066ff" },
  error: { label: "Error", color: "#ff4d4f" },
  aborted: { label: "Aborted", color: "#f97316" },
};

export function ChatHeader({
  title,
  status,
  accentColor,
}: ChatHeaderProps): React.ReactElement {
  const cfg = STATUS_CONFIG[status];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 14px",
        borderBottom: `1px solid ${accentColor}22`,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif",
        fontSize: 13,
        color: "#1e1e1e",
        userSelect: "none",
      }}
    >
      <span
        style={{
          fontWeight: 600,
          color: "#1e1e1e",
          letterSpacing: 0.2,
        }}
      >
        {title}
      </span>
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
            color: "#6b7280",
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: cfg.color,
            boxShadow: "0 0 0 1px rgba(148,163,184,0.35)",
            animation:
              status === "running" ? "pulse 1.4s ease-in-out infinite" : "none",
          }}
        />
        {cfg.label}
      </span>
    </div>
  );
}
