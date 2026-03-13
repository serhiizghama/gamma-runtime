import type { AgentStatus } from "@gamma/types";

interface ChatHeaderProps {
  title: string;
  status: AgentStatus;
  accentColor?: string;
  onClose?: () => void;
}

const STATUS_CONFIG: Record<AgentStatus, { label: string; color: string }> = {
  idle: { label: "Idle", color: "var(--color-text-secondary)" },
  running: { label: "Thinking…", color: "var(--color-accent-primary)" },
  error: { label: "Error", color: "#ff4d4f" },
  aborted: { label: "Aborted", color: "#f97316" },
};

export function ChatHeader({
  title,
  status,
  onClose,
}: ChatHeaderProps): React.ReactElement {
  const cfg = STATUS_CONFIG[status];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "var(--space-2) var(--space-4)",
        gap: "var(--space-4)",
        background: "rgba(15, 23, 42, 0.65)",
        backdropFilter: "blur(16px) saturate(180%)",
        WebkitBackdropFilter: "blur(16px) saturate(180%)",
        borderBottom: "1px solid var(--color-border-subtle)",
        fontFamily: "var(--font-system)",
        fontSize: 13,
        color: "var(--color-text-primary)",
        userSelect: "none",
      }}
    >
      {/* Left-aligned group: title + status */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          flex: 1,
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontWeight: 600,
            color: "var(--color-text-primary)",
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
            color: "var(--color-text-secondary)",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: cfg.color,
              boxShadow: "0 0 0 1px var(--color-border-subtle)",
              animation:
                status === "running" ? "pulse 1.4s ease-in-out infinite" : "none",
            }}
          />
          {cfg.label}
        </span>
      </div>

      {/* Right-aligned: Close button only */}
      {onClose && (
        <button
          onClick={onClose}
          title="Close"
          style={{
            flexShrink: 0,
            background: "transparent",
            border: "none",
            color: "var(--color-text-secondary)",
            fontSize: 16,
            cursor: "pointer",
            padding: "var(--space-1) var(--space-2)",
            borderRadius: 4,
            lineHeight: 1,
            transition: "color 200ms ease-out",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--color-text-primary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--color-text-secondary)";
          }}
          aria-label="Close"
        >
          ✕
        </button>
      )}
    </div>
  );
}
