import React, { useState } from "react";
import { useGammaStore } from "../../../store/useGammaStore";
import type { UISettings } from "@gamma/types";

// TODO(architecture): SegmentedControl, SliderRow, and GlassButton are
// generic UI primitives. They should be extracted to the shared component
// library (e.g. @gamma/ui or a shared components/ layer) to avoid
// duplication across apps. Tracked separately.

const SECTION: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
  padding: "20px 0",
  borderBottom: "1px solid var(--color-border-subtle)",
};

const LABEL: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--color-text-muted)",
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
  color: "var(--color-text-muted-strong)",
  fontVariantNumeric: "tabular-nums",
  minWidth: 36,
  textAlign: "right",
};

export function SettingsApp(): React.ReactElement {
  const uiSettings = useGammaStore((s) => s.uiSettings);
  const updateUI = useGammaStore((s) => s.updateUISettings);
  const resetAll = useGammaStore((s) => s.resetAll);

  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const set = <K extends keyof UISettings>(key: K, val: UISettings[K]) =>
    updateUI({ [key]: val } as Partial<UISettings>);

  const handleResetConfirmed = () => {
    resetAll();
    setShowResetConfirm(false);
  };

  return (
    <div
      style={{
        flex: 1,
        overflow: "auto",
        padding: "0 24px 32px",
        fontFamily: "var(--font-system)",
        color: "var(--color-text-primary)",
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
                color: "var(--color-text-muted)",
                margin: "4px 0 0",
              }}
            >
              Clears session, windows, and preferences
            </p>
          </div>
          <GlassButton danger onClick={() => setShowResetConfirm(true)}>
            Reset
          </GlassButton>
        </div>
      </div>

      {/* ── Reset Confirmation Modal ────────────────────────────── */}
      {showResetConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-confirm-title"
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--color-overlay)",
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: "var(--color-surface-elevated)",
              border: "1px solid var(--color-border-subtle)",
              borderRadius: 16,
              padding: "28px 32px",
              maxWidth: 360,
              width: "100%",
              display: "flex",
              flexDirection: "column",
              gap: 20,
              boxShadow: "var(--shadow-modal)",
            }}
          >
            <div>
              <p
                id="reset-confirm-title"
                style={{ fontSize: 16, fontWeight: 600, margin: "0 0 8px" }}
              >
                Reset All Settings?
              </p>
              <p style={{ fontSize: 13, color: "var(--color-text-muted)", margin: 0 }}>
                This will permanently clear your session, windows, and all
                preferences. This action cannot be undone.
              </p>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <GlassButton onClick={() => setShowResetConfirm(false)}>
                Cancel
              </GlassButton>
              <GlassButton danger onClick={handleResetConfirmed}>
                Reset Everything
              </GlassButton>
            </div>
          </div>
        </div>
      )}
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
        background: "var(--color-surface-muted)",
        borderRadius: 10,
        padding: 3,
        gap: 2,
      }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
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
              value === o.value ? "var(--color-surface-muted-strong)" : "transparent",
            color:
              value === o.value
                ? "var(--color-text-on-muted-strong)"
                : "var(--color-text-muted)",
            boxShadow:
              value === o.value ? "var(--shadow-soft)" : "none",
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
          accentColor: "var(--color-accent)",
          cursor: "pointer",
          height: 4,
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span
          style={{ fontSize: 10, color: "var(--color-text-faint)" }}
        >{`${min}${unit}`}</span>
        <span
          style={{ fontSize: 10, color: "var(--color-text-faint)" }}
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
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: "7px 18px",
        borderRadius: 9,
        border: danger
          ? "1px solid var(--button-danger-border)"
          : "1px solid var(--button-ghost-border)",
        background: danger
          ? hovered
            ? "var(--button-danger-bg-hover)"
            : "var(--button-danger-bg)"
          : hovered
          ? "var(--button-ghost-bg-hover)"
          : "var(--button-ghost-bg)",
        color: danger ? "var(--button-danger-fg)" : "var(--button-ghost-fg)",
        fontSize: 13,
        fontWeight: 500,
        fontFamily: "var(--font-system)",
        cursor: "pointer",
        whiteSpace: "nowrap",
        transition: "background 150ms ease",
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}
