import type { AgentStatus } from "@gamma/types";

interface ChatHeaderProps {
  title: string;
  status: AgentStatus;
  accentColor?: string;
  onClose?: () => void;
}

export function ChatHeader({
  title,
  onClose,
}: ChatHeaderProps): React.ReactElement {

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "var(--space-2) var(--space-4)",
        gap: "var(--space-4)",
        background: "rgba(15, 23, 42, 0.65)",
        backdropFilter: "none",
        WebkitBackdropFilter: "none",
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
