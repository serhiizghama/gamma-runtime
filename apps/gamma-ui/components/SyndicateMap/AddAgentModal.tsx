/**
 * AddAgentModal — Modal for adding an agent to an existing team.
 *
 * Opened from the ➕ button on TeamGroupNode.
 * Posts to POST /api/agents with the team's ID.
 */

import { useState, useEffect, useCallback, type CSSProperties } from "react";
import { API_BASE } from "../../constants/api";
import { systemAuthHeaders } from "../../lib/auth";
import { RolePicker } from "./RolePicker";
import { useRoles, type RoleEntry } from "../../hooks/useRoles";

// ── Props ────────────────────────────────────────────────────────────────

interface AddAgentModalProps {
  teamId: string;
  teamName: string;
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
  maxWidth: 480,
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

export function AddAgentModal({
  teamId,
  teamName,
  onClose,
  onCreated,
}: AddAgentModalProps) {
  const { roles } = useRoles();
  const [selectedRole, setSelectedRole] = useState<RoleEntry | null>(null);
  const [agentName, setAgentName] = useState("");
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
    selectedRole !== null || (isCustomMode && customRoleText.trim().length > 0);

  const handleSubmit = async () => {
    if (!isValid || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const roleId = isCustomMode
        ? "specialized/specialized-custom-agent"
        : selectedRole!.id;

      // name is required by backend DTO — resolve from role if empty
      const resolvedName =
        agentName.trim() ||
        (isCustomMode
          ? "Custom Agent"
          : selectedRole?.name ||
            roles.find((r) => r.id === roleId)?.name ||
            "Agent");

      const res = await fetch(`${API_BASE}/api/agents`, {
        method: "POST",
        headers: {
          ...systemAuthHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          roleId,
          name: resolvedName,
          teamId,
          customDirectives: isCustomMode
            ? customRoleText.trim()
            : undefined,
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
        <div style={titleStyle}>Add Agent to {teamName}</div>

        {/* Role */}
        <div style={fieldGroup}>
          <label style={labelStyle}>Role *</label>
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

        {/* Agent Name */}
        <div style={fieldGroup}>
          <label style={labelStyle}>Agent Name</label>
          <input
            style={inputStyle}
            type="text"
            value={agentName}
            onChange={(e) => setAgentName(e.target.value)}
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
            {submitting ? "Adding..." : "Add Agent"}
          </button>
        </div>
      </div>
    </div>
  );
}
