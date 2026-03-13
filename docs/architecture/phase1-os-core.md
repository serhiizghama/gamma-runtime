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
│  Express / Fastify + Redis Streams                       │
└──────────────┬──────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────┐
│                       Redis                              │
│  Stream key: gamma:system:events                         │
│  XADD → auto-ID, XREAD → fan-out, MAXLEN → auto-prune   │
└─────────────────────────────────────────────────────────┘
```

### Phase 1 User Interaction Flow

1. **Boot** → `<GammaOS />` mounts, Zustand store initializes, SSE connection opens with `Last-Event-ID` header
2. **Desktop renders** → wallpaper visible, Dock anchored bottom, `<Launchpad />` mounted but `visibility: hidden`
3. **User clicks "Apps"** → `launchpadOpen = true` → desktop dims, Launchpad grid fades in
4. **User clicks app icon** → `openWindow(appId)` → `WindowNode` added, `focusedWindowId` set
5. **User drags TitleBar** → `pointermove` → local Ref + RAF (no Zustand). On `pointerup` → single `updateWindowPosition`
6. **User resizes window** → drag resize handle → local Ref + RAF updates CSS vars. On `pointerup` → single `updateWindowDimensions`
7. **User minimizes** → `isMinimized: true`, component stays mounted, `visibility: hidden`
8. **SSE event** → Redis Stream → Node.js → client toast → click → `focusWindow(id)`
9. **Window closes** → app component `useEffect` cleanup fires → WebSocket closed, intervals cleared, WebGL destroyed → `delete state.windows[id]`
10. **Window crashes** → `ErrorBoundary` catches, fallback renders, OS kernel alive

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
  --window-min-width: 320px;
  --window-min-height: 200px;

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

**Rule:** Only animate `transform` and `opacity`. Never `width`, `height`, `top`, `left`.

```css
@keyframes windowOpen {
  from { opacity: 0; transform: scale(0.92) translateY(8px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}

@keyframes windowMinimize {
  to { opacity: 0; transform: scale(0.08) translate(var(--dock-target-x), var(--dock-target-y)); }
}

.window {
  position: absolute;
  width: var(--win-w);
  height: var(--win-h);
  transform: translate(var(--win-x, 0px), var(--win-y, 0px));
  will-change: transform, opacity;
  animation: windowOpen var(--duration-normal) var(--spring-fast) forwards;
}

.window--minimized {
  visibility: hidden;
  pointer-events: none;
}

.desktop--launchpad-open {
  background: var(--color-bg-secondary);
}
```

### Drag & Drop — Two-Phase (No Zustand during motion)

```
pointermove → RAF → el.style.setProperty('--win-x', x)  ← 0 React re-renders
pointerup   → updateWindowPosition(id, {x, y})           ← 1 Zustand write
```

### Window Resize — Two-Phase (Same pattern as drag)

```
pointermove → RAF → el.style.setProperty('--win-w', w)  ← 0 React re-renders
                    el.style.setProperty('--win-h', h)
pointerup   → updateWindowDimensions(id, {width, height}) ← 1 Zustand write
```

---

## 3. React Component Architecture

```
<GammaOS />                              # Root kernel. SSE hook. OS-level ErrorBoundary.
├── <Desktop />                          # Wallpaper. Launchpad blur class.
├── <Launchpad />                        # Always mounted. visibility toggled.
│   └── <AppIcon /> × N                 # onClick → openWindow(appId)
├── <WindowManager />                    # Maps store.windows → WindowNode. Pure renderer.
│   └── <ErrorBoundary key={id}>        # Per-window. Resets on re-open via key.
│       └── <WindowNode id={id} />      # Drag, resize, focus. CSS vars via local Ref.
│           ├── <TitleBar />            # Traffic lights. Drag handle (onPointerDown).
│           ├── <AppContent appId />    # Dynamic import. MUST implement cleanup contract.
│           └── <ResizeHandles />       # 8 handles (N/S/E/W + corners). Each onPointerDown.
├── <Dock />                             # Fixed bottom. Icons + minimized slots.
│   ├── <DockIcon appId />
│   └── <DockMinimizedSlot id />        # onClick → focusWindow(id)
└── <NotificationCenter />               # SSE toast queue.
    └── <ToastNotification />
```

### Single Responsibility

| Component | Responsibility |
|---|---|
| `<GammaOS />` | SSE init, global keyboard shortcuts (Esc), OS-level ErrorBoundary |
| `<Desktop />` | Wallpaper render, launchpad overlay class |
| `<Launchpad />` | App grid, visibility toggle, outside-click dismiss |
| `<WindowManager />` | Map store.windows → components, nothing else |
| `<ErrorBoundary />` | Catch render errors, render fallback |
| `<WindowNode />` | Drag + resize via local refs, click-to-focus |
| `<TitleBar />` | Traffic light buttons, drag initiation |
| `<ResizeHandles />` | 8 resize handles, resize initiation |
| `<AppContent />` | Dynamic app import, **owns cleanup contract** |
| `<Dock />` | Icon rendering, magnification, minimized slots |
| `<NotificationCenter />` | SSE event → toast queue |

### Focus detection — zero N re-renders

```typescript
// Inside <WindowNode id={id} />
const isFocused = useOSStore(s => s.focusedWindowId === id);
// Re-renders ONLY when this specific window's focus changes
```

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
  id: string;                      // uuid v4
  appId: string;
  title: string;
  coordinates: WindowCoordinates;
  dimensions: WindowDimensions;
  zIndex: number;
  isMinimized: boolean;
  isMaximized: boolean;
  // ❌ NO isFocused here — was causing O(N) re-renders
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
  focusedWindowId: string | null;   // ✅ scalar — O(1) focus, O(1) re-render

  launchpadOpen: boolean;
  notifications: Notification[];
  toastQueue: Notification[];

  openWindow: (appId: string, title: string) => void;
  closeWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  maximizeWindow: (id: string) => void;
  updateWindowPosition: (id: string, coords: WindowCoordinates) => void;  // pointerup only
  updateWindowDimensions: (id: string, dims: WindowDimensions) => void;   // pointerup only

  toggleLaunchpad: () => void;
  closeLaunchpad: () => void;

  pushNotification: (n: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void;
  dismissToast: (id: string) => void;
}
```

### Zustand Store

```typescript
// store/useOSStore.ts
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { v4 as uuid } from 'uuid';

const INITIAL_Z = 100;

export const useOSStore = create<OSStore>()(
  immer((set) => ({
    windows: {},
    zIndexCounter: INITIAL_Z,
    focusedWindowId: null,
    launchpadOpen: false,
    notifications: [],
    toastQueue: [],

    openWindow: (appId, title) => set(state => {
      const id = uuid();
      const z = state.zIndexCounter + 1;
      state.windows[id] = {
        id, appId, title,
        coordinates: { x: 120 + Math.random() * 80, y: 80 + Math.random() * 40 },
        dimensions: { width: 800, height: 560 },
        zIndex: z,
        isMinimized: false,
        isMaximized: false,
        openedAt: Date.now(),
      };
      state.zIndexCounter = z;
      state.focusedWindowId = id;
    }),

    closeWindow: (id) => set(state => {
      delete state.windows[id];
      if (state.focusedWindowId === id) {
        const remaining = Object.values(state.windows)
          .filter(w => !w.isMinimized)
          .sort((a, b) => b.zIndex - a.zIndex);
        state.focusedWindowId = remaining[0]?.id ?? null;
      }
    }),

    minimizeWindow: (id) => set(state => {
      if (!state.windows[id]) return;
      state.windows[id].isMinimized = true;
      if (state.focusedWindowId === id) {
        const remaining = Object.values(state.windows)
          .filter(w => !w.isMinimized && w.id !== id)
          .sort((a, b) => b.zIndex - a.zIndex);
        state.focusedWindowId = remaining[0]?.id ?? null;
      }
    }),

    focusWindow: (id) => set(state => {
      if (!state.windows[id]) return;
      const z = state.zIndexCounter + 1;
      state.windows[id].isMinimized = false;
      state.windows[id].zIndex = z;
      state.zIndexCounter = z;
      state.focusedWindowId = id;
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

    // ⚠️ ONLY called on pointerup — never on pointermove
    updateWindowPosition: (id, coords) => set(state => {
      if (state.windows[id]) state.windows[id].coordinates = coords;
    }),

    // ⚠️ ONLY called on pointerup — never on pointermove
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

### Window Resize Implementation

```typescript
// Inside <ResizeHandles /> — same two-phase pattern as drag
type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const onResizePointerDown = (edge: ResizeEdge) => (e: React.PointerEvent) => {
  e.stopPropagation(); // prevent drag from firing
  const w = windows[id];
  const initW = w.dimensions.width;
  const initH = w.dimensions.height;
  const initX = w.coordinates.x;
  const initY = w.coordinates.y;
  const startX = e.clientX;
  const startY = e.clientY;

  const onMove = (ev: PointerEvent) => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;

    let newW = initW, newH = initH, newX = initX, newY = initY;

    if (edge.includes('e')) newW = Math.max(320, initW + dx);
    if (edge.includes('s')) newH = Math.max(200, initH + dy);
    if (edge.includes('w')) { newW = Math.max(320, initW - dx); newX = initX + (initW - newW); }
    if (edge.includes('n')) { newH = Math.max(200, initH - dy); newY = initY + (initH - newH); }

    // DOM-only during resize — zero React
    requestAnimationFrame(() => {
      nodeRef.current!.style.setProperty('--win-w', `${newW}px`);
      nodeRef.current!.style.setProperty('--win-h', `${newH}px`);
      nodeRef.current!.style.setProperty('--win-x', `${newX}px`);
      nodeRef.current!.style.setProperty('--win-y', `${newY}px`);
    });
  };

  const onUp = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', onMove);
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    // Single Zustand write to persist
    let newW = initW, newH = initH, newX = initX, newY = initY;
    if (edge.includes('e')) newW = Math.max(320, initW + dx);
    if (edge.includes('s')) newH = Math.max(200, initH + dy);
    if (edge.includes('w')) { newW = Math.max(320, initW - dx); newX = initX + (initW - newW); }
    if (edge.includes('n')) { newH = Math.max(200, initH - dy); newY = initY + (initH - newH); }
    updateWindowDimensions(id, { width: newW, height: newH });
    updateWindowPosition(id, { x: newX, y: newY });
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp, { once: true });
};
```

### Re-render Guarantee

| Action | Windows that re-render |
|---|---|
| `openWindow` | 1 new window |
| `focusWindow(id)` | 1 (zIndex) |
| `pointermove` drag | 0 — DOM only |
| `pointerup` drag | 1 (coordinates) |
| `pointermove` resize | 0 — DOM only |
| `pointerup` resize | 1 (dimensions) |
| `pushNotification` | 0 windows |

---

## 5. Fault Tolerance & Lifecycle Management

### Error Boundary

```typescript
// components/WindowErrorBoundary.tsx
import { Component, ErrorInfo, ReactNode } from 'react';

interface Props { windowId: string; appId: string; children: ReactNode; }
interface State { hasError: boolean; error?: Error; }

export class WindowErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[GammaOS] Window ${this.props.windowId} crashed:`, error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="window-crash-fallback">
          <span>⚠️</span>
          <p>{this.props.appId} crashed</p>
          <p>{this.state.error?.message}</p>
          <button onClick={() => this.setState({ hasError: false })}>Restart</button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

### Minimized Window Lifecycle

```
OPEN      → mounted, visible,  pointer-events: auto
MINIMIZED → mounted, hidden,   pointer-events: none   (visibility: hidden)
CLOSED    → cleanup fires → unmounted → removed from store
```

### [FIX #2] App Cleanup Contract — Mandatory

**Every `<AppContent />` component MUST implement cleanup on unmount.** This is a hard architectural rule, not optional.

When `closeWindow(id)` fires:
1. Zustand removes window from store
2. React unmounts `<WindowNode />` → `<AppContent />`
3. `useEffect` cleanup fires — **this is the only guarantee against zombie processes**

Without explicit cleanup: WebSocket stays open, `setInterval` keeps firing, WebGL context stays allocated. These are invisible memory leaks.

**Mandatory pattern for every app component:**

```typescript
// Every app component MUST follow this pattern
export function AgentMonitorApp() {
  const wsRef = useRef<WebSocket | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);

  useEffect(() => {
    // Init connections
    wsRef.current = new WebSocket('wss://...');
    intervalRef.current = setInterval(tick, 1000);

    // ✅ MANDATORY cleanup — fires on closeWindow → unmount
    return () => {
      wsRef.current?.close();
      if (intervalRef.current) clearInterval(intervalRef.current);
      // WebGL context: lose it explicitly to free GPU memory
      glRef.current?.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);
}
```

**Enforcement:** Code review gate — PRs adding new app components must include cleanup block or be rejected.

### [NOTE] Security & Sandboxing Roadmap

**Phase 1 (current):** All apps run in the same JS thread as the OS kernel. Acceptable because all app code is first-party and trusted. Apps have access to `window` and `useOSStore.getState()` — this is a known tradeoff.

**Phase 2 (future — third-party or autonomous AI agents):** Must migrate to isolated execution:

```
Option A: <iframe sandbox="allow-scripts allow-same-origin">
  - Full DOM isolation
  - Communication via postMessage with typed message schema
  - OS kernel is not reachable from iframe context

Option B: Web Workers
  - No DOM access (safe for logic-only agents)
  - OffscreenCanvas for WebGL rendering
  - postMessage for bidirectional communication
  - Shared state via SharedArrayBuffer (requires COOP/COEP headers)
```

This is a Phase 2 concern. Phase 1 implementation proceeds with same-thread execution.

---

## 6. Backend Contracts — Redis Streams

### [FIX #3] Redis Streams Replace ZSET + Pub/Sub

**Previous pattern (eliminated):**
- `ZSET` for event log + manual `ZREMRANGEBYSCORE` on every write → O(log N) write + cleanup overhead at high RPS
- `Pub/Sub` for fan-out → no persistence, message lost if subscriber not connected at publish time

**Redis Streams — designed exactly for this:**
- `XADD gamma:system:events MAXLEN ~ 10000 * field value` — appends event, auto-generates monotonic ID, auto-prunes to 10k entries in one atomic command
- `XREAD COUNT 100 STREAMS gamma:system:events lastId` — replay missed events using stream ID as cursor (native `Last-Event-ID` equivalent)
- No separate Pub/Sub channel needed — stream acts as both persistent log and delivery mechanism

```
XADD gamma:system:events MAXLEN ~ 10000 * type notification payload {...}
  → returns: "1709123456789-0"  (millisecond timestamp + sequence = monotonic ID)
  → auto-prunes stream to ~10000 entries (~ = approximate, more efficient)
  → all XREAD consumers receive it

XREAD BLOCK 0 COUNT 10 STREAMS gamma:system:events 1709123456000-0
  → returns all entries after given ID
  → BLOCK 0 = wait indefinitely (long-poll style, perfect for SSE)
```

### Node.js SSE Implementation (Redis Streams)

```typescript
// events/systemBus.ts
import { createClient } from 'redis';

const writeClient  = createClient({ url: process.env.REDIS_URL });
const readClient   = createClient({ url: process.env.REDIS_URL }); // blocking reads need own client

await Promise.all([writeClient.connect(), readClient.connect()]);

const STREAM_KEY = 'gamma:system:events';
const STREAM_MAXLEN = 10_000;

export interface SSEPayload {
  type: 'notification' | 'agent_status' | 'system_alert';
  data: object;
}

// Emit from anywhere in backend — cluster-safe, no INCR needed (stream auto-IDs)
export async function emitSystemEvent(payload: SSEPayload): Promise<string> {
  const id = await writeClient.xAdd(
    STREAM_KEY,
    '*',                          // auto-generate ID (timestamp-based, monotonic)
    { type: payload.type, data: JSON.stringify(payload.data) },
    { TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold: STREAM_MAXLEN } }
  );
  return id; // e.g. "1709123456789-0"
}
```

```typescript
// routes/events.ts
app.get('/api/v1/system/events', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Last-Event-ID from browser header = last Redis Stream ID seen by client
  // On fresh connect: '0-0' (read from beginning of available log)
  // On reconnect: browser sends last received ID automatically
  let lastId = (req.headers['last-event-id'] as string) || '0-0';

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);

  // Each SSE connection gets its own blocking read loop
  const readerClient = readClient.duplicate();
  await readerClient.connect();

  let active = true;

  req.on('close', async () => {
    active = false;
    clearInterval(heartbeat);
    await readerClient.disconnect();
  });

  // Blocking read loop — XREAD BLOCK waits for new entries, no polling
  while (active) {
    const results = await readerClient.xRead(
      [{ key: STREAM_KEY, id: lastId }],
      { COUNT: 100, BLOCK: 25_000 } // 25s block timeout matches heartbeat
    );

    if (!results || !active) continue;

    for (const stream of results) {
      for (const entry of stream.messages) {
        const { type, data } = entry.message;
        res.write(`id: ${entry.id}\n`);
        res.write(`event: ${type}\n`);
        res.write(`data: ${data}\n\n`);
        lastId = entry.id; // advance cursor
      }
    }
  }
});
```

### Why This Works Across Instances

| Scenario | Old (ZSET+PubSub) | New (Redis Streams) |
|---|---|---|
| Server restart | ❌ eventLog lost | ✅ stream persists |
| PM2 cluster | ❌ split-brain Pub/Sub | ✅ all read from same stream |
| K8s rolling deploy | ❌ missed events | ✅ `Last-Event-ID` = stream cursor |
| High RPS cleanup | ❌ `ZREMRANGEBYSCORE` on every write | ✅ `MAXLEN ~` in XADD, amortized |
| New subscriber joins late | ❌ Pub/Sub = lost | ✅ XREAD from any past ID |

### GET `/api/v1/apps`

```typescript
interface InstalledApp {
  id: string;
  name: string;
  icon: string;
  version: string;
  category: 'system' | 'agent' | 'utility';
  singleton: boolean;
}

interface AppsResponse {
  apps: InstalledApp[];
  schema_version: 1;
}
```

### SSE Event Payloads

```typescript
interface NotificationPayload {
  appId: string;
  title: string;
  body: string;
  priority: 'low' | 'normal' | 'high';
}

// Wire format (Redis Stream entry → SSE):
// id: 1709123456789-0
// event: notification
// data: {"appId":"agent-monitor","title":"Agent done","body":"3.2s","priority":"normal"}
```

### Client-Side SSE

```typescript
// hooks/useSystemEvents.ts
export function useSystemEvents() {
  const pushNotification = useOSStore(s => s.pushNotification);

  useEffect(() => {
    const connect = () => {
      // Browser auto-sends Last-Event-ID on reconnect
      // Value = last Redis Stream ID — backend uses it as XREAD cursor
      const es = new EventSource('/api/v1/system/events');

      es.addEventListener('notification', (e: MessageEvent) => {
        const payload: NotificationPayload = JSON.parse(e.data);
        pushNotification({ appId: payload.appId, title: payload.title, body: payload.body });
      });

      es.onerror = () => {
        es.close();
        setTimeout(connect, 3_000);
      };

      return es;
    };

    const es = connect();
    return () => es.close();
  }, []);
}
```

---

## 7. State Hydration — Refresh-Resistance

### Problem

`useOSStore` exists exclusively in browser memory. A page reload (F5) or accidental tab close destroys the entire OS session state: open windows, their coordinates, minimized states, and running agent connections.

### Phase 1 — localStorage Snapshot

Minimal viable hydration using Zustand `persist` middleware:

```typescript
// store/useOSStore.ts
import { persist, createJSONStorage } from 'zustand/middleware';

export const useOSStore = create<OSStore>()(
  persist(
    immer((set) => ({ /* ...store implementation... */ })),
    {
      name: 'gamma-os-session',
      storage: createJSONStorage(() => localStorage),
      // Only persist layout state — never volatile connection handles
      partialize: (state) => ({
        windows: Object.fromEntries(
          Object.entries(state.windows).map(([id, w]) => [id, {
            ...w,
            // Strip non-serializable refs if any
          }])
        ),
        zIndexCounter: state.zIndexCounter,
        focusedWindowId: state.focusedWindowId,
      }),
    }
  )
);
```

On mount, `<GammaOS />` reads the persisted snapshot and restores window layout before first paint. App components reconnect their own WebSocket/WebGL in their `useEffect` — the OS kernel just provides the coordinates.

### Phase 2 — Server-Side Session (PostgreSQL/Redis)

For multi-device and agent-continuity use cases:

```
POST /api/v1/session/snapshot   ← client pushes state delta every 30s or on change
GET  /api/v1/session/restore    ← on mount, before store init

Table: os_sessions
  id           uuid  PK
  user_id      uuid  FK
  windows_json jsonb           -- serialized window layout
  updated_at   timestamptz
```

**Key rule:** Window coordinates and open process list are part of the Session Context. Agent state (LLM context, memory) is NOT stored here — it lives in the Agent Daemon layer (see §8).

---

## 8. Process Lifecycle — UI Process vs Daemon Process

### Separation of Concerns

Closing a window ≠ killing a background agent. These are two distinct lifecycles:

```
┌─────────────────────────────────────────────────────────┐
│  UI Process (Window)              Daemon Process (Agent) │
│  ──────────────────               ──────────────────── │
│  Lifecycle: tied to DOM           Lifecycle: independent │
│  Controlled by: Zustand store     Controlled by: backend │
│  Close action: unmount + cleanup  Close action: explicit │
│                                   kill via API           │
│  WS conn: closes on unmount       LLM stream: persists   │
│                                   until task complete    │
└─────────────────────────────────────────────────────────┘
```

### Backend Agent API

```typescript
// Agent daemon — independent of UI window lifecycle
interface AgentProcess {
  id: string;          // uuid
  appId: string;
  status: 'running' | 'idle' | 'completed' | 'failed';
  startedAt: number;
  task?: string;
}

// REST endpoints
GET  /api/v1/agents                    // list running daemon processes
POST /api/v1/agents/:id/kill           // explicit kill (separate from window close)
GET  /api/v1/agents/:id/output         // SSE stream of agent output
```

### Window ↔ Agent Binding

When `AgentMonitorApp` opens:
1. UI window mounts → establishes WS to `/api/v1/agents/:id/output`
2. If agent daemon is NOT running → backend starts it, returns `agentId`
3. If agent daemon IS running (resumed session) → WS attaches to existing stream

When window closes:
1. `useEffect` cleanup → WS closes (client-side only)
2. Backend detects WS disconnect → agent daemon **continues running**
3. Agent output is buffered in Redis Stream (`gamma:agents:<id>:output`)
4. When window re-opens → WS reconnects, replays buffered output via `Last-Event-ID`

```typescript
// <AgentMonitorApp /> cleanup contract
useEffect(() => {
  const ws = new WebSocket(`wss://api/v1/agents/${agentId}/output`);
  wsRef.current = ws;

  return () => {
    // ✅ Closes WS only — does NOT kill the agent daemon
    ws.close(1000, 'window_closed');
    // Backend sees close code 1000 → keeps agent alive
    // Backend sees close code 1001 (going away) or explicit kill API → stops agent
  };
}, [agentId]);
```

---

## 9. Connection Draining — Graceful SSE Shutdown

### Problem

SSE connections are long-lived TCP connections. On rolling deploy (PM2 reload, K8s rolling update), the process receives `SIGTERM`. Without explicit draining, connected clients hang until TCP timeout (~90s).

### Implementation

```typescript
// server/graceful-shutdown.ts
const activeSSEClients = new Set<Response>();

// Register on connect, deregister on close
app.get('/api/v1/system/events', async (req, res) => {
  activeSSEClients.add(res);
  req.on('close', () => activeSSEClients.delete(res));

  // ...existing SSE implementation...
});

// SIGTERM handler
process.on('SIGTERM', async () => {
  console.log('[GammaOS] SIGTERM received — draining SSE connections');

  // 1. Stop accepting new connections
  server.close();

  // 2. Signal all clients to reconnect (they will hit the new instance)
  for (const res of activeSSEClients) {
    // Send retry directive — browser will reconnect with Last-Event-ID
    res.write('retry: 1000\n\n');
    res.end();
  }
  activeSSEClients.clear();

  // 3. Flush Redis writes, close connections
  await Promise.all([writeClient.quit(), readClient.quit()]);

  // 4. Exit cleanly
  process.exit(0);
});
```

### Kubernetes Lifecycle Hook

```yaml
# deployment.yaml
lifecycle:
  preStop:
    exec:
      command: ["/bin/sh", "-c", "sleep 5"]  # let LB drain before SIGTERM
terminationGracePeriodSeconds: 30
```

**Flow on rolling deploy:**
1. K8s sends `preStop` → pod sleeps 5s (LB removes from rotation)
2. K8s sends `SIGTERM` → handler drains SSE, sends `retry: 1000` to all clients
3. Clients reconnect in 1s to the new pod, using `Last-Event-ID` as Redis Stream cursor
4. Zero missed events — Redis Stream persists across pod restarts

---

## 10. Memory Bus — Architecture Bridge

### Concept

Redis Streams `gamma:system:events` serves as UI transport (notifications, toasts). For thesis-grade agent memory tracing, a parallel **Memory Bus** is required — a dedicated event stream for all memory read/write transactions across Vector DB and PostgreSQL.

### Stream Topology

```
┌───────────────────────────────────────────────────────────┐
│                    Redis Streams                           │
│                                                            │
│  gamma:system:events     ← UI transport (notifications)   │
│                                                            │
│  gamma:memory:bus        ← Memory Bus (agent transactions) │
│    ├── type: vector_write   (embedding stored)             │
│    ├── type: vector_read    (similarity search result)     │
│    ├── type: pg_write       (structured memory saved)      │
│    ├── type: pg_read        (context retrieved)            │
│    └── type: decision_node  (LLM decision checkpoint)      │
└───────────────────────────────────────────────────────────┘
```

### Memory Bus Event Schema

```typescript
// types/memory-bus.ts

export type MemoryEventType =
  | 'vector_write'
  | 'vector_read'
  | 'pg_write'
  | 'pg_read'
  | 'decision_node';

export interface MemoryBusEvent {
  id: string;              // Redis Stream auto-ID (timestamp-based)
  agentId: string;
  sessionId: string;
  type: MemoryEventType;
  payload: {
    query?: string;        // for reads
    content?: string;      // for writes
    embedding?: number[];  // vector ops
    score?: number;        // similarity score on read
    table?: string;        // pg ops
    decisionLabel?: string;  // decision_node: human-readable checkpoint
    parentNodeId?: string;   // decision tree edge
  };
  timestamp: number;
}
```

### Emitting Memory Bus Events

```typescript
// memory/memoryBus.ts
import { emitSystemEvent } from '../events/systemBus';

const MEMORY_STREAM_KEY = 'gamma:memory:bus';

export async function emitMemoryEvent(event: Omit<MemoryBusEvent, 'id' | 'timestamp'>) {
  const id = await writeClient.xAdd(
    MEMORY_STREAM_KEY,
    '*',
    {
      agentId: event.agentId,
      sessionId: event.sessionId,
      type: event.type,
      payload: JSON.stringify(event.payload),
    },
    { TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold: 50_000 } }
  );
  return id;
}

// Called from vector DB wrapper:
// await emitMemoryEvent({ agentId, sessionId, type: 'vector_write', payload: { content, embedding } });
```

### Canvas Visualizer — Real-Time Decision Tree

The client subscribes to a dedicated SSE endpoint for Memory Bus events:

```typescript
// hooks/useMemoryBus.ts
export function useMemoryBus(agentId: string) {
  const [nodes, setNodes] = useState<DecisionNode[]>([]);
  const [edges, setEdges] = useState<DecisionEdge[]>([]);

  useEffect(() => {
    const es = new EventSource(`/api/v1/agents/${agentId}/memory-stream`);

    es.addEventListener('decision_node', (e: MessageEvent) => {
      const event: MemoryBusEvent = JSON.parse(e.data);
      setNodes(prev => [...prev, {
        id: event.id,
        label: event.payload.decisionLabel ?? event.type,
        timestamp: event.timestamp,
      }]);
      if (event.payload.parentNodeId) {
        setEdges(prev => [...prev, {
          from: event.payload.parentNodeId!,
          to: event.id,
        }]);
      }
    });

    es.addEventListener('vector_read', (e: MessageEvent) => {
      // Highlight retrieved memory nodes on canvas
    });

    return () => es.close();
  }, [agentId]);

  return { nodes, edges };
}
```

The Canvas component renders the decision tree using `useMemoryBus()`, giving a real-time visualization of the agent's reasoning chain — directly relevant to the thesis claim about observable, auditable AI decision-making.

### Kafka Migration Path (Phase 3)

Redis Streams provide at-least-once delivery with manual acknowledgment (`XACK`). For thesis-grade ordering guarantees (strict total order across distributed nodes):

| Property | Redis Streams | Kafka |
|---|---|---|
| Ordering | Per-stream, monotonic | Per-partition, strict |
| Retention | MAXLEN (size-bound) | Time-bound (configurable) |
| Throughput | ~100k msg/s | ~1M+ msg/s |
| Consumer groups | ✅ `XREADGROUP` | ✅ native |
| Schema registry | ❌ manual | ✅ Confluent/Apicurio |
| Replay from offset | ✅ stream ID | ✅ topic offset |

Migration is non-breaking: replace `emitMemoryEvent()` internals, keep the SSE API contract identical. Recommended trigger: when Memory Bus throughput exceeds 50k events/s or when multi-region deployment is required.

---

## 11. Engineering Watch-outs

### ⚠️ Watch-out #1 — CSS Stacking Context & React Portals

**Problem:** `transform: translate(...)` on `<WindowNode />` creates a new [Stacking Context](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_stacking_context) for every window. Any popup rendered inside `<AppContent />` — `<select>` dropdowns, datepickers, tooltips, context menus — will be clipped by the window boundary if `overflow: hidden` is set, or will fail to stack above sibling windows regardless of `z-index`.

This is a browser-level constraint, not a CSS bug. `z-index` only competes within the same Stacking Context.

**Solution: React Portals for all floating UI**

Portals render children into a DOM node outside the component tree hierarchy — in this case, directly into `<GammaOS />` root — bypassing the Stacking Context of individual windows entirely.

```typescript
// components/Portal.tsx
import { createPortal } from 'react-dom';
import { useRef, useEffect, useState } from 'react';

interface PortalProps {
  anchorRef: React.RefObject<HTMLElement>;  // element to anchor the popup to
  children: React.ReactNode;
}

export function Portal({ anchorRef, children }: PortalProps) {
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setCoords({ top: rect.bottom, left: rect.left });
  }, [anchorRef]);

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: coords.top,
        left: coords.left,
        zIndex: 9999,   // above all windows — no Stacking Context conflict
      }}
    >
      {children}
    </div>,
    document.getElementById('gamma-os-portal-root')!  // sibling of <GammaOS /> in DOM
  );
}
```

```html
<!-- index.html — portal root must be outside the main app tree -->
<div id="root"></div>
<div id="gamma-os-portal-root"></div>
```

**Rule:** Every floating UI element inside `<AppContent />` (dropdown, tooltip, context menu, datepicker) **must** use `<Portal>`. This is a code review gate — same as the cleanup contract in §5.

---

### ⚠️ Watch-out #2 — Redis Stream ID Precision Loss

**Problem:** Redis Stream IDs have the format `1526919030474-55` — a millisecond Unix timestamp followed by a sequence number. The timestamp part alone (`1526919030474`) exceeds `Number.MAX_SAFE_INTEGER` (`2^53 - 1 = 9007199254740991`), which means any JavaScript numeric parse will cause silent precision loss.

```typescript
// ❌ NEVER do this
const id = Number('1526919030474-55');    // NaN
const id = parseInt('1526919030474-55');  // 1526919030474 — looks fine now,
                                          // but will silently corrupt at higher values

// ✅ Always treat as opaque string
const lastId: string = entry.id;  // '1526919030474-55'
res.write(`id: ${lastId}\n`);     // pass through verbatim
```

**Enforcement rules:**

| Context | Rule |
|---|---|
| SSE `id:` field | Write as-is from Redis entry, never parse |
| `Last-Event-ID` header | Read as `req.headers['last-event-id'] as string` |
| XREAD cursor | Pass directly to `xRead([{ key, id: lastId }])` |
| TypeScript types | Always `string`, never `number` or `bigint` |
| Logging | `JSON.stringify({ id: entry.id })` — string field |

```typescript
// types/redis.ts
export type StreamID = string;  // '1526919030474-55' — never parse numerically

// Correct XREAD cursor advancement
let lastId: StreamID = '0-0';

for (const entry of stream.messages) {
  res.write(`id: ${entry.id}\n`);   // ✅ verbatim
  lastId = entry.id;                 // ✅ string assignment, no parse
}
```

---

### ⚠️ Watch-out #3 — Memory Bus Throttling

**Problem:** During active Vector DB searches, an agent can emit hundreds of `decision_node` events per second. Forwarding each event individually through SSE triggers a `setNodes` call on every message, causing:
- React to re-render the Canvas on every event
- Browser to parse and process hundreds of SSE frames per second
- Main thread to saturate — UI freezes

**Solution: Backend batching + frontend debounce**

**Backend — batch flush every 150ms:**

```typescript
// events/memoryBusSSE.ts
app.get('/api/v1/agents/:id/memory-stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let lastId: StreamID = (req.headers['last-event-id'] as string) || '0-0';
  let batch: MemoryBusEvent[] = [];
  let active = true;

  req.on('close', () => { active = false; });

  // Flush accumulated batch every 150ms
  const flushInterval = setInterval(() => {
    if (batch.length === 0 || !active) return;

    res.write(`event: batch\n`);
    res.write(`id: ${batch[batch.length - 1].id}\n`);    // cursor = last event in batch
    res.write(`data: ${JSON.stringify(batch)}\n\n`);
    batch = [];
  }, 150);

  req.on('close', () => clearInterval(flushInterval));

  // Read loop — accumulate, don't flush immediately
  while (active) {
    const results = await readerClient.xRead(
      [{ key: `gamma:memory:bus`, id: lastId }],
      { COUNT: 500, BLOCK: 150 }
    );
    if (!results || !active) continue;

    for (const stream of results) {
      for (const entry of stream.messages) {
        batch.push(JSON.parse(entry.message.payload));
        lastId = entry.id;
      }
    }
  }
});
```

**Frontend — process batch, not individual events:**

```typescript
// hooks/useMemoryBus.ts
export function useMemoryBus(agentId: string) {
  const [nodes, setNodes] = useState<DecisionNode[]>([]);
  const [edges, setEdges] = useState<DecisionEdge[]>([]);

  useEffect(() => {
    const es = new EventSource(`/api/v1/agents/${agentId}/memory-stream`);

    // ✅ Single batch event — one setState call for N events
    es.addEventListener('batch', (e: MessageEvent) => {
      const events: MemoryBusEvent[] = JSON.parse(e.data);

      const newNodes: DecisionNode[] = [];
      const newEdges: DecisionEdge[] = [];

      for (const event of events) {
        if (event.type === 'decision_node') {
          newNodes.push({ id: event.id, label: event.payload.decisionLabel ?? event.type });
          if (event.payload.parentNodeId) {
            newEdges.push({ from: event.payload.parentNodeId, to: event.id });
          }
        }
      }

      // One re-render for the entire batch
      setNodes(prev => [...prev, ...newNodes]);
      setEdges(prev => [...prev, ...newEdges]);
    });

    return () => es.close();
  }, [agentId]);

  return { nodes, edges };
}
```

**Performance profile:**

| Scenario | Without batching | With 150ms batching |
|---|---|---|
| 500 events/s | 500 `setState` / s → freeze | ~7 `setState` / s → smooth |
| React renders/s | 500 | 7 |
| SSE frames/s | 500 | 7 |
| `Last-Event-ID` accuracy | Per-event | Last in batch (sufficient) |

**Tuning:** 150ms is a starting point. Adjust based on agent throughput profile:
- Interactive UI feedback needed → 50–100ms
- Batch analytics / post-hoc review → 500ms–1s

---

## Architectural Decision Log

| # | Decision | Rationale |
|---|---|---|
| 1 | `focusedWindowId` scalar in store | Eliminates O(N) re-renders on focus change |
| 2 | Drag + Resize via local Ref + RAF; Zustand only on `pointerup` | Guarantees 60fps, zero React involvement during motion |
| 3 | Redis Streams (`XADD MAXLEN`) replaces ZSET + Pub/Sub | Single structure for both persistence and fan-out; `MAXLEN ~` auto-prunes; cursor-based replay |
| 4 | `visibility: hidden` for minimized windows | Preserves WebSocket, WebGL, local state — no remount cost |
| 5 | ErrorBoundary `key={windowId}` | Auto-reset on re-open, no stale error state |
| 6 | Mandatory cleanup contract in every `<AppContent />` | Prevents zombie WebSockets, intervals, and WebGL contexts on window close |
| 7 | Phase 1 same-thread execution; Phase 2 iframe/Worker sandbox | Pragmatic for first-party apps; isolation deferred to when third-party agents exist |
| 8 | 8-handle resize (`n/s/e/w/ne/nw/se/sw`) | Full OS-grade window resizing from any edge or corner |
| 9 | localStorage hydration (Phase 1) → PostgreSQL session (Phase 2) | Incremental: browser-local first, server-persistent when multi-device needed |
| 10 | UI Process / Daemon Process separation | Window close ≠ agent kill; agent runs to completion, output buffered in Redis |
| 11 | SIGTERM drains SSE via `retry` directive | Zero missed events on rolling deploy; browser reconnects with Last-Event-ID cursor |
| 12 | Separate `gamma:memory:bus` stream | UI transport and memory tracing are distinct concerns; Memory Bus feeds Canvas visualizer |
| 13 | Redis Streams now, Kafka later | Pragmatic for Phase 1-2; Kafka migration path defined for Phase 3 scale |
| 14 | React Portals for all floating UI | `transform` creates Stacking Context — portals bypass it; mandatory code review gate |
| 15 | Redis Stream IDs always `string` | `1526919030474-55` exceeds `Number.MAX_SAFE_INTEGER`; numeric parse = silent corruption |
| 16 | Memory Bus SSE batching at 150ms | 500 events/s → 7 `setState/s`; one re-render per batch instead of per event |

---

*Gamma OS Phase 1 Spec v5 — revised 2026-03-08*
