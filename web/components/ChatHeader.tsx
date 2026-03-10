import type { AgentStatus } from "@gamma/types";

interface ChatHeaderProps {
  title: string;
  status: AgentStatus;
  accentColor: string;
}

const STATUS_CONFIG: Record<AgentStatus, { label: string; color: string }> = {
  idle: { label: "Idle", color: "#888" },
  running: { label: "Running…", color: "#00ff41" },
  error: { label: "Error", color: "#ff4444" },
  aborted: { label: "Aborted", color: "#ff8800" },
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
        fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
        fontSize: 13,
        color: "#ccc",
        userSelect: "none",
      }}
    >
      <span style={{ fontWeight: 600, color: accentColor }}>{title}</span>
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          color: cfg.color,
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: cfg.color,
            boxShadow:
              status === "running" ? `0 0 6px ${cfg.color}` : "none",
            animation:
              status === "running" ? "pulse 1.4s ease-in-out infinite" : "none",
          }}
        />
        {cfg.label}
      </span>
    </div>
  );
}
