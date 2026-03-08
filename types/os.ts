export interface WindowCoordinates {
  x: number;
  y: number;
}

export interface WindowDimensions {
  width: number;
  height: number;
}

export interface WindowNode {
  id: string;
  appId: string;
  title: string;
  coordinates: WindowCoordinates;
  dimensions: WindowDimensions;
  zIndex: number;
  isMinimized: boolean;
  isMaximized: boolean;
  prevCoordinates?: WindowCoordinates;
  prevDimensions?: WindowDimensions;
  openedAt: number;
}

export interface Notification {
  id: string;
  appId: string;
  title: string;
  body: string;
  timestamp: number;
  read: boolean;
}

export interface UISettings {
  theme: "dark" | "light";
  bgBlur: number;            // px — blob filter blur (60–140)
  bgSpeed: number;           // s  — base breath cycle duration (10–60)
  backgroundType: "live" | "matrix";
}

export interface OSStore {
  windows: Record<string, WindowNode>;
  zIndexCounter: number;
  focusedWindowId: string | null;

  launchpadOpen: boolean;
  notifications: Notification[];
  toastQueue: Notification[];

  uiSettings: UISettings;

  openWindow: (appId: string, title: string) => void;
  closeWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  maximizeWindow: (id: string) => void;
  updateWindowPosition: (id: string, coords: WindowCoordinates) => void;
  updateWindowDimensions: (id: string, dims: WindowDimensions) => void;

  toggleLaunchpad: () => void;
  closeLaunchpad: () => void;

  pushNotification: (n: Omit<Notification, "id" | "timestamp" | "read">) => void;
  dismissToast: (id: string) => void;

  updateUISettings: (patch: Partial<UISettings>) => void;
  setBackgroundType: (type: UISettings["backgroundType"]) => void;
  resetAll: () => void;
}
