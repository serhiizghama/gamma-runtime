import React from "react";
import { useOSStore } from "../store/useOSStore";

export function Dock(): React.ReactElement {
  const toggleLaunchpad = useOSStore((s) => s.toggleLaunchpad);
  const launchpadOpen = useOSStore((s) => s.launchpadOpen);
  const focusWindow = useOSStore((s) => s.focusWindow);

  // Only minimized windows appear in the Dock
  const minimizedWindows = useOSStore((s) =>
    Object.values(s.windows).filter((w) => w.isMinimized)
  );

  return (
    <div
      style={{
        position: "fixed",
        bottom: 12,
        left: "50%",
        transform: "translateX(-50%)",
        background: "var(--dock-bg)",
        backdropFilter: "var(--dock-blur)",
        WebkitBackdropFilter: "var(--dock-blur)",
        borderRadius: "var(--dock-radius)",
        padding: "var(--dock-padding)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        minHeight: 72,
        zIndex: 1000,
        border: "1px solid var(--glass-border)",
        boxShadow: "var(--glass-shadow)",
        transition: "transform 280ms cubic-bezier(0.34,1.56,0.64,1)",
      }}
    >
      {/* Launchpad toggle button */}
      <DockItem
        icon="⊞"
        label="Apps"
        active={launchpadOpen}
        onClick={toggleLaunchpad}
        title="Launchpad"
      />

      {/* Divider — only if there are minimized windows */}
      {minimizedWindows.length > 0 && (
        <div
          style={{
            width: 1,
            height: 40,
            background: "var(--glass-border)",
            margin: "0 4px",
            flexShrink: 0,
          }}
        />
      )}

      {/* Minimized windows */}
      {minimizedWindows.map((win) => (
        <DockItem
          key={win.id}
          icon="🗗"
          label={win.title}
          active={false}
          onClick={() => focusWindow(win.id)}
          title={`Restore ${win.title}`}
        />
      ))}
    </div>
  );
}

interface DockItemProps {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
  title: string;
}

function DockItem({ icon, label, active, onClick, title }: DockItemProps): React.ReactElement {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: "var(--dock-icon-size)",
        height: "var(--dock-icon-size)",
        borderRadius: 14,
        background: active
          ? "rgba(255,255,255,0.18)"
          : "rgba(255,255,255,0.06)",
        border: active
          ? "1px solid rgba(255,255,255,0.24)"
          : "1px solid transparent",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        cursor: "pointer",
        padding: 0,
        transition: "background 150ms ease, transform 180ms cubic-bezier(0.34,1.56,0.64,1)",
        flexShrink: 0,
        position: "relative",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-6px) scale(1.15)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0) scale(1)";
      }}
    >
      <span style={{ fontSize: 28, lineHeight: 1 }}>{icon}</span>
      <span
        style={{
          fontSize: 9,
          color: "var(--text-secondary)",
          fontFamily: "var(--font-system)",
          maxWidth: 52,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          lineHeight: 1,
        }}
      >
        {label}
      </span>
    </button>
  );
}
