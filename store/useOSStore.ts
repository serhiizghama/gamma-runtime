import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { persist, createJSONStorage } from "zustand/middleware";
import { v4 as uuid } from "uuid";
import type { OSStore, Notification, WindowNode } from "../types/os";

const INITIAL_Z = 100;

function pickNextFocused(
  windows: Record<string, WindowNode>,
  excludeId: string
): string | null {
  const remaining = Object.values(windows)
    .filter((w) => !w.isMinimized && w.id !== excludeId)
    .sort((a, b) => b.zIndex - a.zIndex);
  return remaining[0]?.id ?? null;
}

export const useOSStore = create<OSStore>()(
  persist(
    immer((set) => ({
      windows: {},
      zIndexCounter: INITIAL_Z,
      focusedWindowId: null,
      launchpadOpen: false,
      notifications: [],
      toastQueue: [],

      openWindow: (appId, title) =>
        set((state) => {
          const id = uuid();
          const z = state.zIndexCounter + 1;
          state.windows[id] = {
            id,
            appId,
            title,
            coordinates: {
              x: 120 + Math.random() * 80,
              y: 80 + Math.random() * 40,
            },
            dimensions: { width: 800, height: 560 },
            zIndex: z,
            isMinimized: false,
            isMaximized: false,
            openedAt: Date.now(),
          };
          state.zIndexCounter = z;
          state.focusedWindowId = id;
        }),

      closeWindow: (id) =>
        set((state) => {
          delete state.windows[id];
          if (state.focusedWindowId === id) {
            state.focusedWindowId = pickNextFocused(state.windows, id);
          }
        }),

      minimizeWindow: (id) =>
        set((state) => {
          if (!state.windows[id]) return;
          state.windows[id].isMinimized = true;
          if (state.focusedWindowId === id) {
            state.focusedWindowId = pickNextFocused(state.windows, id);
          }
        }),

      focusWindow: (id) =>
        set((state) => {
          if (!state.windows[id]) return;
          const z = state.zIndexCounter + 1;
          state.windows[id].isMinimized = false;
          state.windows[id].zIndex = z;
          state.zIndexCounter = z;
          state.focusedWindowId = id;
        }),

      maximizeWindow: (id) =>
        set((state) => {
          const w = state.windows[id];
          if (!w) return;
          if (w.isMaximized) {
            w.coordinates = w.prevCoordinates ?? w.coordinates;
            w.dimensions = w.prevDimensions ?? w.dimensions;
            w.isMaximized = false;
          } else {
            w.prevCoordinates = { ...w.coordinates };
            w.prevDimensions = { ...w.dimensions };
            w.coordinates = { x: 0, y: 0 };
            w.dimensions = {
              width: window.innerWidth,
              height: window.innerHeight,
            };
            w.isMaximized = true;
          }
        }),

      updateWindowPosition: (id, coords) =>
        set((state) => {
          if (state.windows[id]) state.windows[id].coordinates = coords;
        }),

      updateWindowDimensions: (id, dims) =>
        set((state) => {
          if (state.windows[id]) state.windows[id].dimensions = dims;
        }),

      toggleLaunchpad: () =>
        set((state) => {
          state.launchpadOpen = !state.launchpadOpen;
        }),

      closeLaunchpad: () =>
        set((state) => {
          state.launchpadOpen = false;
        }),

      pushNotification: (n) =>
        set((state) => {
          const notif: Notification = {
            ...n,
            id: uuid(),
            timestamp: Date.now(),
            read: false,
          };
          state.notifications.unshift(notif);
          state.toastQueue.push(notif);
        }),

      dismissToast: (id) =>
        set((state) => {
          state.toastQueue = state.toastQueue.filter((t) => t.id !== id);
        }),
    })),
    {
      name: "gamma-os-session",
      storage: createJSONStorage(() => localStorage),
      // ONLY persist window layout — never UI state or notification queues
      partialize: (state) => ({
        windows: state.windows,
        zIndexCounter: state.zIndexCounter,
        focusedWindowId: state.focusedWindowId,
      }),
    }
  )
);
