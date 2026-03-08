import { useEffect } from "react";
import { useOSStore } from "../store/useOSStore";

const MOCK_EVENTS = [
  { appId: "terminal", title: "Agent Process",   body: "Task completed successfully." },
  { appId: "browser",  title: "Download Finished", body: "gamma-os-spec-v5.pdf is ready." },
  { appId: "notes",    title: "Auto-Save",        body: "Your notes have been saved." },
  { appId: "settings", title: "Update Available", body: "Gamma OS 0.2.0 is ready to install." },
];

let mockIndex = 0;

/**
 * useSystemEvents — mock SSE hook.
 * In production this will open an EventSource to /api/events (Redis Streams via SSE).
 * For now it fires a fake notification every 15 seconds.
 */
export function useSystemEvents(): void {
  useEffect(() => {
    const id = setInterval(() => {
      const payload = MOCK_EVENTS[mockIndex % MOCK_EVENTS.length];
      mockIndex += 1;
      useOSStore.getState().pushNotification(payload);
    }, 15_000);

    return () => clearInterval(id);
  }, []);
}
