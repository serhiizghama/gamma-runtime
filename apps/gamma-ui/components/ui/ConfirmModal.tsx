import React, { useEffect } from "react";

const MODAL_OVERLAY: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
};

const MODAL_BOX: React.CSSProperties = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: 8,
  padding: "20px 24px",
  maxWidth: 420,
  width: "100%",
  fontFamily: "var(--font-system)",
  fontSize: 13,
  boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
};

const MODAL_TITLE: React.CSSProperties = {
  fontWeight: 700,
  marginBottom: 10,
  fontSize: 14,
};

const MODAL_BODY: React.CSSProperties = {
  opacity: 0.85,
  marginBottom: 18,
  lineHeight: 1.5,
};

const MODAL_ACTIONS: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
};

const BTN: React.CSSProperties = {
  background: "var(--color-surface-muted)",
  border: "1px solid var(--color-border-subtle)",
  color: "var(--color-text-primary)",
  padding: "5px 12px",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 11,
  fontFamily: "inherit",
};

const BTN_DANGER: React.CSSProperties = {
  ...BTN,
  background: "var(--button-danger-bg)",
  border: "1px solid var(--button-danger-border)",
  color: "var(--button-danger-fg)",
};

const BTN_MUTED: React.CSSProperties = {
  ...BTN,
  background: "transparent",
  border: "1px solid var(--color-border-subtle)",
  opacity: 0.7,
};

export interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps): React.ReactElement {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  return (
    <div style={MODAL_OVERLAY} onClick={onCancel}>
      <div style={MODAL_BOX} onClick={(e) => e.stopPropagation()}>
        <div style={MODAL_TITLE}>{title}</div>
        <div style={MODAL_BODY}>{message}</div>
        <div style={MODAL_ACTIONS}>
          <button type="button" style={BTN_MUTED} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            style={danger ? BTN_DANGER : BTN}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export interface AlertModalProps {
  title: string;
  message: string;
  onClose: () => void;
}

export function AlertModal({ title, message, onClose }: AlertModalProps): React.ReactElement {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div style={MODAL_OVERLAY} onClick={onClose}>
      <div style={MODAL_BOX} onClick={(e) => e.stopPropagation()}>
        <div style={MODAL_TITLE}>{title}</div>
        <div style={MODAL_BODY}>{message}</div>
        <div style={MODAL_ACTIONS}>
          <button type="button" style={BTN} onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

