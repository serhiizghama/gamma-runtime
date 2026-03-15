import React, { useEffect, useRef, useState, useCallback } from "react";
import { useGammaStore } from "../store/useGammaStore";
import { INSTALLED_APPS } from "../constants/apps";
import type { Notification } from "@gamma/types";

interface ToastNotificationProps {
  notification: Notification;
}

export function ToastNotification({ notification }: ToastNotificationProps): React.ReactElement {
  const dismissToast = useGammaStore((s) => s.dismissToast);
  const focusWindow = useGammaStore((s) => s.focusWindow);

  const [dismissing, setDismissing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startDismiss = useCallback(() => {
    if (dismissing) return;
    setDismissing(true);
    // Wait for slide-out animation (180ms) then remove from queue
    setTimeout(() => dismissToast(notification.id), 190);
  }, [dismissing, dismissToast, notification.id]);

  // Auto-dismiss after 5s
  useEffect(() => {
    timerRef.current = setTimeout(startDismiss, 5000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [startDismiss]);

  const handleClick = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    // Find a window for this appId and focus it
    const windows = useGammaStore.getState().windows;
    const match = Object.values(windows).find((w) => w.appId === notification.appId);
    if (match) focusWindow(match.id);
    startDismiss();
  }, [notification.appId, focusWindow, startDismiss]);

  const app = INSTALLED_APPS.find((a) => a.id === notification.appId);
  const icon = app?.icon ?? "🔔";
  const appName = app?.name ?? notification.appId;

  return (
    <div
      className={`toast-notification${dismissing ? " toast-notification--dismissing" : ""}`}
      onClick={handleClick}
      style={{
        background: "var(--notif-bg)",
        backdropFilter: "var(--glass-blur)",
        WebkitBackdropFilter: "var(--glass-blur)",
        borderRadius: "var(--notif-radius)",
        boxShadow: "var(--notif-shadow)",
        border: "1px solid var(--glass-border)",
        padding: "12px 14px",
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        cursor: "pointer",
        width: 300,
        minHeight: 64,
        flexShrink: 0,
      }}
    >
      {/* App icon */}
      <span style={{ fontSize: 28, lineHeight: 1, flexShrink: 0, marginTop: 2 }}>
        {icon}
      </span>

      {/* Content */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <div
          style={{
            fontSize: 11,
            color: "var(--color-text-secondary)",
            fontFamily: "var(--font-system)",
            marginBottom: 2,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          {appName}
        </div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--color-text-primary)",
            fontFamily: "var(--font-system)",
            marginBottom: 3,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {notification.title}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--color-text-secondary)",
            fontFamily: "var(--font-system)",
            lineHeight: 1.4,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          } as React.CSSProperties}
        >
          {notification.body}
        </div>
      </div>

      {/* Dismiss button */}
        <button
        onClick={(e) => { e.stopPropagation(); startDismiss(); }}
        style={{
          background: "transparent",
          border: "none",
          color: "var(--color-text-secondary)",
          cursor: "pointer",
          fontSize: 14,
          lineHeight: 1,
          padding: "0 2px",
          flexShrink: 0,
          marginTop: -2,
          fontFamily: "var(--font-system)",
        }}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
