import { useState, useEffect, useRef } from "react";
import { API_BASE } from "../constants/api";

// ── Types ────────────────────────────────────────────────────────────────

type HealthStatus = "ok" | "degraded" | "error" | "offline";

interface MenuBarProps {
  onOpenArchitect: () => void;
  onOpenLaunchpad: () => void;
}

// ── Status Config ────────────────────────────────────────────────────────

const STATUS_DISPLAY: Record<HealthStatus, { label: string; color: string }> = {
  ok: { label: "OK", color: "#0066ff" },
  degraded: { label: "Degraded", color: "#facc15" },
  error: { label: "Error", color: "#ff4d4f" },
  offline: { label: "Offline", color: "#9ca3af" },
};

const MENU_HEIGHT = 28;

// ── Component ────────────────────────────────────────────────────────────

export function MenuBar({
  onOpenArchitect,
  onOpenLaunchpad,
}: MenuBarProps): React.ReactElement {
  const [health, setHealth] = useState<HealthStatus>("ok");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/system/health`);
        if (!res.ok) throw new Error("not ok");
        const data = await res.json();
        if (mountedRef.current) {
          setHealth(
            (data.status as HealthStatus) === "ok"
              ? "ok"
              : (data.status as HealthStatus) === "degraded"
                ? "degraded"
                : "error",
          );
        }
      } catch {
        if (mountedRef.current) setHealth("offline");
      }
    };

    poll();
    const id = setInterval(poll, 30_000);

    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, []);

  const st = STATUS_DISPLAY[health];

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: MENU_HEIGHT,
        background: "rgba(255, 255, 255, 0.4)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        borderBottom: "1px solid #e5e5e5",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 16px",
        zIndex: 10000,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif",
        fontSize: 11,
        letterSpacing: 0.08,
        color: "#1e1e1e",
        userSelect: "none",
      }}
    >
      {/* Left: Brand + System Status */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: 2,
          }}
        >
          GAMMA OS
        </span>
        <span
          title={`System: ${health}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            color: "#4b5563",
            cursor: "default",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "999px",
              backgroundColor: st.color,
              boxShadow:
                health === "ok"
                  ? "0 0 0 1px rgba(0,102,255,0.2)"
                  : "0 0 0 1px rgba(148,163,184,0.35)",
            }}
          />
          <span>{st.label}</span>
        </span>
      </div>

      {/* Right: Apps + Architect */}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button
          onClick={onOpenLaunchpad}
          title="Apps"
          style={{
            background: "transparent",
            border: "none",
            color: "#4b5563",
            fontSize: 14,
            cursor: "pointer",
            padding: "3px 10px",
            borderRadius: 6,
            transition: "background 0.15s, color 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(0, 102, 255, 0.08)";
            e.currentTarget.style.color = "#0066ff";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "#4b5563";
          }}
        >
          ☰
        </button>
        <button
          onClick={onOpenArchitect}
          title="System Architect"
          style={{
            background: "transparent",
            border: "none",
            color: "#4b5563",
            fontSize: 14,
            cursor: "pointer",
            padding: "3px 10px",
            borderRadius: 6,
            transition: "background 0.15s, color 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(0, 102, 255, 0.08)";
            e.currentTarget.style.color = "#0066ff";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "#4b5563";
          }}
        >
          💬
        </button>
      </div>
    </div>
  );
}

export { MENU_HEIGHT };
