import { useState, useEffect, useRef } from "react";
import { API_BASE } from "../constants/api";

// ── Types ────────────────────────────────────────────────────────────────

type HealthStatus = "ok" | "degraded" | "error" | "offline";

interface MenuBarProps {
  onOpenArchitect: () => void;
  onOpenLaunchpad: () => void;
}

// ── Status Config ────────────────────────────────────────────────────────

const STATUS_DISPLAY: Record<HealthStatus, { icon: string; color: string }> = {
  ok: { icon: "🟢", color: "#00ff41" },
  degraded: { icon: "🟡", color: "#ffaa00" },
  error: { icon: "🔴", color: "#ff4444" },
  offline: { icon: "🔴", color: "#ff4444" },
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
        background: "rgba(10, 10, 10, 0.85)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 12px",
        zIndex: 10000,
        fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
        fontSize: 12,
        color: "#ccc",
        userSelect: "none",
      }}
    >
      {/* Left: Logo + System Status */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: "#00ff41",
            letterSpacing: 1,
          }}
        >
          Γ
        </span>
        <span
          title={`System: ${health}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 11,
            color: st.color,
            cursor: "default",
          }}
        >
          {st.icon}
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
            color: "#ccc",
            fontSize: 15,
            cursor: "pointer",
            padding: "2px 8px",
            borderRadius: 4,
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.08)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
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
            color: "#ccc",
            fontSize: 15,
            cursor: "pointer",
            padding: "2px 8px",
            borderRadius: 4,
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.08)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          💬
        </button>
      </div>
    </div>
  );
}

export { MENU_HEIGHT };
