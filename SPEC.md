# Gamma OS — Phase 1 Technical Specification & PRD

---

## 1. Architecture Overview & User Flow

### High-Level System Design

```
┌─────────────────────────────────────────────────────────┐
│                     Browser (Client)                     │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │                  <GammaOS />                     │   │
│  │  ┌─────────────┐  ┌──────────────────────────┐  │   │
│  │  │  <Desktop /> │  │    <WindowManager />     │  │   │
│  │  │  background  │  │  [WindowNode] × N        │  │   │
│  │  │  wallpaper   │  │  each: ErrorBoundary     │  │   │
│  │  └─────────────┘  └──────────────────────────┘  │   │
│  │  ┌─────────────────────────────────────────────┐ │   │
│  │  │              <Launchpad />                  │ │   │
│  │  │         (mounted, visibility toggled)        │ │   │
│  │  └─────────────────────────────────────────────┘ │   │
│  │  ┌─────────────────────────────────────────────┐ │   │
│  │  │    <Dock />  +  <NotificationCenter />      │ │   │
│  │  └─────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│         Zustand Store (OS Kernel State)                  │
└───────────────────────────┬─────────────────────────────┘
                            │ SSE  /api/v1/system/events
                            │ REST /api/v1/apps
┌───────────────────────────▼─────────────────────────────┐
│                    Node.js Backend                        │
│  Express / Fastify + SSE EventEmitter bus                │
└─────────────────────────────────────────────────────────┘
```

### Phase 1 User Interaction Flow

1. **Boot** → `<GammaOS />` mounts, Zustand store initializes, SSE connection opens to `/api/v1/system/events` with `Last-Event-ID: 0`
2. **Desktop renders** → wallpaper visible, Dock anchored bottom, `<Launchpad />` mounted but `visibility: hidden`
3. **User clicks "Apps" in Dock** → Zustand `ui.launchpadOpen = true` → desktop dims with `backdrop-filter: blur(20px)`, Launchpad grid fades in via CSS `@keyframes`
4. **User clicks app icon** → `openWindow(appId)` dispatched → new `WindowNode` added to store → `<WindowNode />` mounts, auto-focused (highest z-index)
5. **User drags window** → `pointermove` events update `coordinates` in store via throttled RAF callback
6. **User minimizes window** → `minimizeWindow(id)` → `isMinimized: true`, component stays mounted, CSS `visibility: hidden + scale(0.1)` animates to Dock
7. **SSE event arrives** → `NotificationCenter` receives toast → clicking toast calls `focusWindow(id)` → unminimizes + brings to front
8. **Window crashes** → `ErrorBoundary` catches, renders fallback UI, OS kernel unaffected

---

## 2. UI/UX & CSS Architecture

### Core Design Tokens (CSS Variables)

```css
:root {
  /* Glass morphism */
  --glass-bg: rgba(30, 30, 32, 0.72);
  --glass-border: rgba(255, 255, 255, 0.08);
  --glass-blur: blur(20px) saturate(180%);
  --glass-shadow: 0 22px 70px rgba(0, 0, 0, 0.56);

  /* macOS window chrome */
  --window-bg: rgba(28, 28, 30, 0.85);
  --window-titlebar-height: 28px;
  --window-radius: 12px;
  --window-border: 1px solid rgba(255, 255, 255, 0.06);

  /* Dock */
  --dock-bg: rgba(255, 255, 255, 0.12);
  --dock-blur: blur(24px) saturate(200%);
  --dock-radius: 18px;
  --dock-icon-size: 56px;
  --dock-padding: 8px 12px;

  /* Typography */
  --font-system: -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif;
  --text-primary: rgba(255, 255, 255, 0.92);
  --text-secondary: rgba(255, 255, 255, 0.48);

  /* Notifications */
  --notif-bg: rgba(44, 44, 46, 0.9);
  --notif-radius: 14px;
  --notif-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);

  /* Traffic lights */
  --btn-close: #ff5f57;
  --btn-minimize: #febc2e;
  --btn-maximize: #28c840;

  /* Motion */
  --spring-fast: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-smooth: cubic-bezier(0.25, 0.46, 0.45, 0.94);
  --duration-fast: 180ms;
  --duration-normal: 280ms;
  --duration-slow: 420ms;
}
```

### Animation Strategy (Zero Layout Thrashing)

**Rule:** Never animate `width`, `height`, `top`, `left`. Only animate `transform` and `opacity` — GPU-composited, zero reflow.

```css
/* Window open */
@keyframes windowOpen {
  from { opacity: 0; transform: scale(0.92) translateY(8px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}

/* Window minimize to Dock */
@keyframes windowMinimize {
  to { opacity: 0; transform: scale(0.08) translate(var(--dock-target-x), var(--dock-target-y)); }
}

/* Launchpad reveal */
@keyframes launchpadIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}

/* App icon bounce on open */
@keyframes iconBounce {
  0%, 100% { transform: translateY(0); }
  40%       { transform: translateY(-12px); }
  60%       { transform: translateY(-6px); }
}

.window {
  will-change: transform, opacity;
  animation: windowOpen var(--duration-normal) var(--spring-fast) forwards;
}

.window--minimized {
  visibility: hidden;
  pointer-events: none;
}

.desktop--launchpad-open {
  backdrop-filter: blur(20px) brightness(0.7);
  transition: backdrop-filter var(--duration-normal) var(--ease-smooth);
}
```

**Dragging** uses `transform: translate(x, y)` set via CSS custom properties updated through RAF:

```ts
requestAnimationFrame(() => {
  el.style.setProperty('--x', `${x}px`);
  el.style.setProperty('--y', `${y}px`);
});
// CSS: transform: translate(var(--x), var(--y))
```

---

## 3. React Component Architecture

```
<GammaOS />                          # Root kernel. Mounts SSE listener. OS-level ErrorBoundary.
├── <Desktop />                      # Static wallpaper layer. Receives launchpadOpen class for blur.
├── <Launchpad />                    # Always mounted. visibility toggled. Dim overlay + icon grid.
│   └── <AppIcon /> × N             # Single app. onClick → openWindow(appId).
├── <WindowManager />                # Renders all WindowNodes from store. Pure renderer.
│   └── <ErrorBoundary key={id}>    # Per-window fault isolation. key=id resets on re-open.
│       └── <WindowNode id={id} />  # Draggable, resizable window shell.
│           ├── <TitleBar />        # Traffic lights + title. Drag handle. Double-click maximizes.
│           └── <AppContent />      # Dynamic import of app component by appId.
├── <Dock />                         # Fixed bottom bar. App icons + minimize slots.
│   ├── <DockIcon appId />          # Static launcher icons.
│   └── <DockMinimizedSlot id />    # Thumbnail of minimized window. onClick → focusWindow(id).
└── <NotificationCenter />           # SSE-driven. Toast queue, auto-dismiss, click-to-focus.
    └── <ToastNotification />        # Single toast. AnimatePresence for enter/exit.
```

### Single Responsibility per Component

| Component | Responsibility |
|---|---|
| `<GammaOS />` | SSE init, global keyboard shortcuts (Esc), OS-level ErrorBoundary |
| `<Desktop />` | Wallpaper render, launchpad overlay class |
| `<Launchpad />` | App grid display, visibility state, outside-click dismiss |
| `<WindowManager />` | Map store windows → WindowNode components, nothing else |
| `<ErrorBoundary />` | Catch render errors, render fallback, report to OS log |
| `<WindowNode />` | Drag, resize, focus-on-click, minimize/maximize/close buttons |
| `<TitleBar />` | Traffic light buttons, drag initiation |
| `<Dock />` | Icon rendering, magnification, minimized slots |
| `<NotificationCenter />` | SSE event → toast queue management |

---

## 4. Global State Management (Zustand & TypeScript)

### TypeScript Interfaces

```typescript
// types/os.ts

export interface WindowCoordinates {
  x: number;
  y: number;
}

export interface WindowDimensions {
  width: number;
  height: number;
}

export interface WindowNode {
  id: string;                    // uuid v4
  appId: string;                 // matches InstalledApp.id
  title: string;
  coordinates: WindowCoordinates;
  dimensions: WindowDimensions;
  zIndex: number;
  isMinimized: boolean;
  isMaximized: boolean;
  isFocused: boolean;
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

export interface OSStore {
  windows: Record<string, WindowNode>;
  zIndexCounter: number;
  launchpadOpen: boolean;
  notifications: Notification[];
  toastQueue: Notification[];

  openWindow: (appId: string, title: string) => void;
  closeWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  maximizeWindow: (id: string) => void;
  updateWindowPosition: (id: string, coords: WindowCoordinates) => void;
  updateWindowDimensions: (id: string, dims: WindowDimensions) => void;

  toggleLaunchpad: () => void;
  closeLaunchpad: () => void;

  pushNotification: (n: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void;
  dismissToast: (id: string) => void;
}
```

### Zustand Store Implementation

```typescript
// store/useOSStore.ts
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { v4 as uuid } from 'uuid';

const INITIAL_Z = 100;
const Z_STEP = 1;

export const useOSStore = create<OSStore>()(
  immer((set) => ({
    windows: {},
    zIndexCounter: INITIAL_Z,
    launchpadOpen: false,
    notifications: [],
    toastQueue: [],

    openWindow: (appId, title) => set(state => {
      const id = uuid();
      const z = state.zIndexCounter + Z_STEP;
      Object.values(state.windows).forEach(w => { w.isFocused = false; });
      state.windows[id] = {
        id, appId, title,
        coordinates: { x: 120 + Math.random() * 80, y: 80 + Math.random() * 40 },
        dimensions: { width: 800, height: 560 },
        zIndex: z,
        isMinimized: false,
        isMaximized: false,
        isFocused: true,
        openedAt: Date.now(),
      };
      state.zIndexCounter = z;
    }),

    closeWindow: (id) => set(state => { delete state.windows[id]; }),

    minimizeWindow: (id) => set(state => {
      if (!state.windows[id]) return;
      state.windows[id].isMinimized = true;
      state.windows[id].isFocused = false;
    }),

    focusWindow: (id) => set(state => {
      if (!state.windows[id]) return;
      const z = state.zIndexCounter + Z_STEP;
      Object.values(state.windows).forEach(w => { w.isFocused = false; });
      state.windows[id].isMinimized = false;
      state.windows[id].isFocused = true;
      state.windows[id].zIndex = z;
      state.zIndexCounter = z;
    }),

    maximizeWindow: (id) => set(state => {
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
        w.dimensions = { width: window.innerWidth, height: window.innerHeight };
        w.isMaximized = true;
      }
    }),

    updateWindowPosition: (id, coords) => set(state => {
      if (state.windows[id]) state.windows[id].coordinates = coords;
    }),

    updateWindowDimensions: (id, dims) => set(state => {
      if (state.windows[id]) state.windows[id].dimensions = dims;
    }),

    toggleLaunchpad: () => set(state => { state.launchpadOpen = !state.launchpadOpen; }),
    closeLaunchpad: () => set(state => { state.launchpadOpen = false; }),

    pushNotification: (n) => set(state => {
      const notif: Notification = { ...n, id: uuid(), timestamp: Date.now(), read: false };
      state.notifications.unshift(notif);
      state.toastQueue.push(notif);
    }),

    dismissToast: (id) => set(state => {
      state.toastQueue = state.toastQueue.filter(t => t.id !== id);
    }),
  }))
);
```

### Z-Index Strategy

No global recalculation. Monotonically incrementing counter. Each `focusWindow` call increments counter by 1 and assigns it. O(1) operation. Counter resets to `INITIAL_Z + windowCount` on hydration to prevent overflow.

---

## 5. Fault Tolerance & Lifecycle Management

### Error Boundary Implementation

```typescript
// components/WindowErrorBoundary.tsx
import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  windowId: string;
  appId: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class WindowErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[GammaOS] Window ${this.props.windowId} (${this.props.appId}) crashed:`, error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="window-crash-fallback">
          <span className="crash-icon">⚠️</span>
          <p className="crash-title">{this.props.appId} crashed</p>
          <p className="crash-body">{this.state.error?.message}</p>
          <button onClick={() => this.setState({ hasError: false })}>Restart</button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

`key={windowId}` on ErrorBoundary ensures automatic reset on window re-open. No stale error state.

### Minimized Window Lifecycle

```
OPEN      → mounted, visible,   pointer-events: auto
MINIMIZED → mounted, hidden,    pointer-events: none   (visibility: hidden)
CLOSED    → unmounted, removed from store
```

**Why `visibility: hidden` over `display: none`:**
- `display: none` → kills WebSocket, WebGL context, local component state
- `visibility: hidden` → stays in React tree, all connections alive, layout preserved

---

## 6. Backend Contracts (Node.js API & SSE)

### GET `/api/v1/apps`

```typescript
interface InstalledApp {
  id: string;
  name: string;
  icon: string;         // URL to SVG/PNG
  version: string;      // semver
  category: 'system' | 'agent' | 'utility';
  singleton: boolean;   // focus existing instead of opening new
}

interface AppsResponse {
  apps: InstalledApp[];
  schema_version: 1;
}
```

### SSE Stream — `GET /api/v1/system/events`

```typescript
// Node.js backend
import { EventEmitter } from 'events';
export const systemBus = new EventEmitter();

const eventLog: SSEEvent[] = [];
let eventCounter = 0;

app.get('/api/v1/system/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Replay missed events on reconnect
  const lastId = parseInt(req.headers['last-event-id'] as string ?? '0');
  eventLog.filter(e => e.id > lastId).forEach(e => sendSSE(res, e));

  // Heartbeat every 25s (prevents proxy timeouts)
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);

  const handler = (event: SSEEvent) => sendSSE(res, event);
  systemBus.on('event', handler);

  req.on('close', () => {
    clearInterval(heartbeat);
    systemBus.off('event', handler);
  });
});

function sendSSE(res: any, event: SSEEvent) {
  res.write(`id: ${event.id}\n`);
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event.payload)}\n\n`);
}

export function emitSystemEvent(type: string, payload: object) {
  const event: SSEEvent = { id: ++eventCounter, type, payload };
  eventLog.push(event);
  if (eventLog.length > 500) eventLog.shift(); // circular buffer
  systemBus.emit('event', event);
}
```

**SSE Event Payload Structure:**

```typescript
interface SSEEvent {
  id: number;
  type: 'notification' | 'agent_status' | 'system_alert';
  payload: NotificationPayload | AgentStatusPayload | SystemAlertPayload;
}

interface NotificationPayload {
  appId: string;
  title: string;
  body: string;
  priority: 'low' | 'normal' | 'high';
}

// Wire format example:
// id: 42
// event: notification
// data: {"appId":"agent-monitor","title":"Agent Finished","body":"Task completed in 3.2s","priority":"normal"}
```

**Client-side SSE hook:**

```typescript
// hooks/useSystemEvents.ts
export function useSystemEvents() {
  const pushNotification = useOSStore(s => s.pushNotification);

  useEffect(() => {
    const connect = () => {
      const es = new EventSource('/api/v1/system/events');
      // Browser auto-sends Last-Event-ID header on reconnect when server sets id: field

      es.addEventListener('notification', (e: MessageEvent) => {
        const payload: NotificationPayload = JSON.parse(e.data);
        pushNotification({ appId: payload.appId, title: payload.title, body: payload.body });
      });

      es.onerror = () => {
        es.close();
        setTimeout(connect, 3000);
      };

      return es;
    };

    const es = connect();
    return () => es.close();
  }, []);
}
```

> Native `EventSource` auto-sends `Last-Event-ID` on reconnect when the server uses `id:` field — zero extra client code needed.

---

*Gamma OS Phase 1 Spec — generated 2026-03-08*
