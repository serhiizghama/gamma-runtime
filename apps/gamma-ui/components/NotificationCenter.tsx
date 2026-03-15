import React from "react";
import { useGammaStore } from "../store/useGammaStore";
import { ToastNotification } from "./ToastNotification";

export function NotificationCenter(): React.ReactElement {
  // Scoped selector — only this component re-renders when toastQueue changes
  const toastQueue = useGammaStore((s) => s.toastQueue);

  return (
    <div
      style={{
        position: "fixed",
        top: 16,
        right: 16,
        zIndex: 2000,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        alignItems: "flex-end",
        pointerEvents: toastQueue.length > 0 ? "auto" : "none",
      }}
    >
      {toastQueue.map((notif) => (
        <ToastNotification key={notif.id} notification={notif} />
      ))}
    </div>
  );
}
