import React from "react";
import { useOSStore } from "../../../store/useOSStore";
import type { UISettings } from "../../../types/os";

const SECTION: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
  padding: "20px 0",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
};

const LABEL: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "rgba(255,255,255,0.35)",
  marginBottom: 4,
};

const ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
};

const VALUE_BADGE: React.CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.45)",
  fontVariantNumeric: "tabular-nums",
  minWidth: 36,
  textAlign: "right",
};

export function SettingsApp(): React.ReactElement {
  const uiSettings = useOSStore((s) => s.uiSettings);
  const updateUI = useOSStore((s) => s.updateUISettings);
  const resetAll = useOSStore((s) => s.resetAll);

  const set = <K extends keyof UISettings>(key: K, val: UISettings[K]) =>
    updateUI({ [key]: val } as Partial<UISettings>);

  return (
    <div
      style={{
        flex: 1,
        overflow: "auto",
        padding: "0 24px 32px",
        fontFamily: "var(--font-system)",
        color: "var(--text-primary)",
      }}
    >
      {/* ── Appearance ─────────────────────────────────────────── */}
      <div style={SECTION}>
        <p style={LABEL}>Appearance</p>

        <div style={ROW}>
          <span style={{ fontSize: 14 }}>Theme</span>
          <SegmentedControl
            options={[
              { value: "dark", label: "🌙 Dark" },
              { value: "light", label: "☀️ Light" },
            ]}
            value={uiSettings.theme}
            onChange={(v) => set("theme", v as UISettings["theme"])}
          />
        </div>
      </div>

      {/* ── Wallpaper ──────────────────────────────────────────── */}
      <div style={SECTION}>
        <p style={LABEL}>Live Background</p>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <SliderRow
            label="Blur Intensity"
            min={40}
            max={140}
            step={5}
            value={uiSettings.bgBlur}
            unit="px"
            onChange={(v) => set("bgBlur", v)}
          />
          <SliderRow
            label="Flow Speed"
            min={10}
            max={60}
            step={2}
            value={uiSettings.bgSpeed}
            unit="s"
            hint={
              uiSettings.bgSpeed <= 16
                ? "Fast"
                : uiSettings.bgSpeed >= 50
                ? "Slow"
                : "Medium"
            }
            onChange={(v) => set("bgSpeed", v)}
          />
        </div>
      </div>

      {/* ── System ─────────────────────────────────────────────── */}
      <div style={{ ...SECTION, borderBottom: "none", paddingBottom: 0 }}>
        <p style={LABEL}>System</p>
        <div style={ROW}>
          <div>
            <p style={{ fontSize: 14, margin: 0 }}>Reset All Settings</p>
            <p
              style={{
                fontSize: 12,
                color: "rgba(255,255,255,0.38)",
                margin: "4px 0 0",
              }}
            >
              Clears session, windows, and preferences
            </p>
          </div>
          <GlassButton danger onClick={resetAll}>
            Reset
          </GlassButton>
        </div>
      </div>
    </div>
  );
}

/* ── Segmented Control ─────────────────────────────────────────── */
interface SegOption {
  value: string;
  label: string;
}
function SegmentedControl({
  options,
  value,
  onChange,
}: {
  options: SegOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        background: "rgba(255,255,255,0.06)",
        borderRadius: 10,
        padding: 3,
        gap: 2,
      }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          style={{
            padding: "5px 14px",
            borderRadius: 8,
            border: "none",
            cursor: "pointer",
            fontSize: 13,
            fontFamily: "var(--font-system)",
            fontWeight: 500,
            transition: "background 160ms ease, color 160ms ease",
            background:
              value === o.value ? "rgba(255,255,255,0.14)" : "transparent",
            color:
              value === o.value
                ? "rgba(255,255,255,0.92)"
                : "rgba(255,255,255,0.40)",
            boxShadow:
              value === o.value ? "0 1px 4px rgba(0,0,0,0.3)" : "none",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ── Slider Row ────────────────────────────────────────────────── */
function SliderRow({
  label,
  min,
  max,
  step,
  value,
  unit,
  hint,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit: string;
  hint?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={ROW}>
        <span style={{ fontSize: 14 }}>{label}</span>
        <span style={VALUE_BADGE}>
          {value}
          {unit}
          {hint ? ` · ${hint}` : ""}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: "100%",
          accentColor: "#6366f1",
          cursor: "pointer",
          height: 4,
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span
          style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}
        >{`${min}${unit}`}</span>
        <span
          style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}
        >{`${max}${unit}`}</span>
      </div>
    </div>
  );
}

/* ── Glass Button ──────────────────────────────────────────────── */
function GlassButton({
  children,
  onClick,
  danger = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "7px 18px",
        borderRadius: 9,
        border: danger
          ? "1px solid rgba(255, 95, 87, 0.35)"
          : "1px solid rgba(255,255,255,0.12)",
        background: danger
          ? "rgba(255, 95, 87, 0.15)"
          : "rgba(255,255,255,0.08)",
        color: danger ? "#ff5f57" : "rgba(255,255,255,0.80)",
        fontSize: 13,
        fontWeight: 500,
        fontFamily: "var(--font-system)",
        cursor: "pointer",
        whiteSpace: "nowrap",
        transition: "background 150ms ease",
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = danger
          ? "rgba(255, 95, 87, 0.28)"
          : "rgba(255,255,255,0.14)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = danger
          ? "rgba(255, 95, 87, 0.15)"
          : "rgba(255,255,255,0.08)";
      }}
    >
      {children}
    </button>
  );
}

