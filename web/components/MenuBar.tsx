const MENU_HEIGHT = 32;

// ── Chat Bubble icon (MessageSquare-style, minimal) ───────────────────────

function MessageSquareIcon(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

// ── Component ────────────────────────────────────────────────────────────

interface MenuBarProps {
  onOpenArchitect: () => void;
  onOpenLaunchpad: () => void;
}

export function MenuBar({
  onOpenArchitect,
  onOpenLaunchpad,
}: MenuBarProps): React.ReactElement {
  return (
    <div
      className="desktop-shell__taskbar"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: MENU_HEIGHT,
        minHeight: MENU_HEIGHT,
        background: "rgba(15, 23, 42, 0.65)",
        backdropFilter: "blur(16px) saturate(180%)",
        WebkitBackdropFilter: "blur(16px) saturate(180%)",
        borderBottom: "1px solid var(--color-border-subtle)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 16px",
        zIndex: 10000,
        fontFamily: "var(--font-system)",
        color: "var(--color-text-primary)",
        userSelect: "none",
      }}
    >
      {/* Left: Branding */}
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--color-text-primary)",
          letterSpacing: 2,
        }}
      >
        Gamma OS
      </span>

      {/* Right: Minimal tray (Apps + Chat) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <button
          onClick={onOpenLaunchpad}
          title="Apps"
          className="desktop-shell__tray-btn"
          aria-label="Open Apps"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <rect x="2" y="2" width="4" height="4" rx="0.5" />
            <rect x="10" y="2" width="4" height="4" rx="0.5" />
            <rect x="2" y="10" width="4" height="4" rx="0.5" />
            <rect x="10" y="10" width="4" height="4" rx="0.5" />
          </svg>
        </button>
        <button
          onClick={onOpenArchitect}
          title="System Architect"
          className="desktop-shell__tray-btn"
          aria-label="System Architect"
        >
          <MessageSquareIcon />
        </button>
      </div>
    </div>
  );
}

export { MENU_HEIGHT };
