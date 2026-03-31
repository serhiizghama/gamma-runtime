/**
 * CreateTeamModal — Inline modal for creating a team with a leader agent.
 *
 * Opened from the "+ Team" button on MapToolbar.
 * Posts to POST /api/teams/create-with-leader atomically.
 */

import { useState, useEffect, useCallback, type CSSProperties } from "react";
import { API_BASE } from "../../constants/api";
import { systemAuthHeaders } from "../../lib/auth";
import { RolePicker } from "./RolePicker";
import type { RoleEntry } from "../../hooks/useRoles";

// ── Props ────────────────────────────────────────────────────────────────

interface CreateTeamModalProps {
  onClose: () => void;
  onCreated: () => void;
}

// ── Styles ───────────────────────────────────────────────────────────────

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.55)",
  zIndex: 9999,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const boxStyle: CSSProperties = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: 12,
  maxWidth: 520,
  width: "92vw",
  padding: "24px 24px 20px",
  boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
};

const titleStyle: CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  fontFamily: "var(--font-system)",
  color: "var(--color-text-primary)",
  marginBottom: 18,
};

const fieldGroup: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  marginBottom: 14,
};

const labelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  fontFamily: "var(--font-system)",
  color: "var(--color-text-secondary)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "var(--space-2, 8px)",
  fontSize: 13,
  fontFamily: "var(--font-system)",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-primary)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: 6,
  outline: "none",
};

const textareaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: 60,
  resize: "vertical",
};

const actionsRow: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  marginTop: 18,
};

const cancelBtn: CSSProperties = {
  padding: "6px 14px",
  fontSize: 12,
  fontWeight: 600,
  fontFamily: "var(--font-system)",
  color: "var(--color-text-secondary)",
  background: "transparent",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: 6,
  cursor: "pointer",
};

const submitBtn: CSSProperties = {
  padding: "6px 16px",
  fontSize: 12,
  fontWeight: 600,
  fontFamily: "var(--font-system)",
  color: "#fff",
  background: "var(--color-accent-primary)",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
};

const submitBtnDisabled: CSSProperties = {
  ...submitBtn,
  opacity: 0.5,
  cursor: "not-allowed",
};

const errorStyle: CSSProperties = {
  fontSize: 11,
  fontFamily: "var(--font-system)",
  color: "var(--color-accent-error, #ff5f57)",
  marginTop: 4,
};

// ── Component ────────────────────────────────────────────────────────────

export function CreateTeamModal({ onClose, onCreated }: CreateTeamModalProps) {
  const [teamName, setTeamName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedRole, setSelectedRole] = useState<RoleEntry | null>(null);
  const [leaderName, setLeaderName] = useState("");
  const [customRoleText, setCustomRoleText] = useState("");
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Escape to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSelectRole = useCallback((role: RoleEntry) => {
    setSelectedRole(role);
    setIsCustomMode(false);
  }, []);

  const toggleCustom = useCallback(() => {
    setIsCustomMode((prev) => !prev);
    if (!isCustomMode) {
      setSelectedRole(null);
    }
  }, [isCustomMode]);

  const isValid =
    teamName.trim().length > 0 &&
    (selectedRole !== null || (isCustomMode && customRoleText.trim().length > 0));

  const handleSubmit = async () => {
    if (!isValid || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      // Determine roleId and name
      const leaderRoleId = isCustomMode
        ? "specialized/specialized-custom-agent"
        : selectedRole!.id;
      const resolvedLeaderName =
        leaderName.trim() || (isCustomMode ? "Custom Agent" : selectedRole!.name);

      const res = await fetch(`${API_BASE}/api/teams/create-with-leader`, {
        method: "POST",
        headers: {
          ...systemAuthHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: teamName.trim(),
          description: description.trim() || undefined,
          leaderRoleId,
          leaderName: resolvedLeaderName,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }

      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={boxStyle} onClick={(e) => e.stopPropagation()}>
        <div style={titleStyle}>Create Team</div>

        {/* Team Name */}
        <div style={fieldGroup}>
          <label style={labelStyle}>Team Name *</label>
          <input
            style={inputStyle}
            type="text"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="e.g. Marketing Squad"
            autoFocus
          />
        </div>

        {/* Description */}
        <div style={fieldGroup}>
          <label style={labelStyle}>Description</label>
          <textarea
            style={textareaStyle}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this team do?"
            rows={2}
          />
        </div>

        {/* Leader Role */}
        <div style={fieldGroup}>
          <label style={labelStyle}>Leader Role *</label>
          <RolePicker
            selectedRoleId={selectedRole?.id ?? null}
            selectedRoleName={selectedRole?.name ?? null}
            selectedRoleEmoji={selectedRole?.emoji ?? null}
            onSelect={handleSelectRole}
            customRoleText={customRoleText}
            onCustomRoleChange={setCustomRoleText}
            isCustomMode={isCustomMode}
            onToggleCustom={toggleCustom}
          />
        </div>

        {/* Leader Name */}
        <div style={fieldGroup}>
          <label style={labelStyle}>Leader Name</label>
          <input
            style={inputStyle}
            type="text"
            value={leaderName}
            onChange={(e) => setLeaderName(e.target.value)}
            placeholder={
              selectedRole
                ? selectedRole.name
                : isCustomMode
                  ? "Custom Agent"
                  : "Select a role first"
            }
          />
        </div>

        {/* Error */}
        {error && <div style={errorStyle}>{error}</div>}

        {/* Actions */}
        <div style={actionsRow}>
          <button style={cancelBtn} onClick={onClose} type="button">
            Cancel
          </button>
          <button
            style={isValid && !submitting ? submitBtn : submitBtnDisabled}
            onClick={handleSubmit}
            disabled={!isValid || submitting}
            type="button"
          >
            {submitting ? "Creating..." : "Create Team"}
          </button>
        </div>
      </div>
    </div>
  );
}
