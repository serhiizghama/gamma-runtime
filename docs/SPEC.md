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
│  Express / Fastify + Redis Pub/Sub + Redis ZSET          │
└──────────────┬──────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────┐
│                       Redis                              │
│  Pub/Sub channel: gamma:system:events                    │
│  ZSET key:        gamma:events:log  (score = event id)   │
└─────────────────────────────────────────────────────────┘
```

### Phase 1 User Interaction Flow

1. **Boot** → `<GammaOS />` mounts, Zustand store initializes, SSE connection opens to `/api/v1/system/events` with `Last-Event-ID` header
2. **Desktop renders** → wallpaper visible, Dock anchored bottom, `<Launchpad />` mounted but `visibility: hidden`
3. **User clicks "Apps" in Dock** → Zustand `ui.launchpadOpen = true` → desktop dims with `backdrop-filter: blur(20px)`, Launchpad grid fades in
4. **User clicks app icon** → `openWindow(appId)` dispatched → new `WindowNode` added to store, `focusedWindowId` set to new id
5. **User drags window** → `pointermove` updates DOM via local Ref + RAF (no Zustand calls). On `pointerup` → single `updateWindowPosition` to persist coordinates
6. **User minimizes window** → `minimizeWindow(id)` → `isMinimized: true`, component stays mounted, CSS `visibility: hidden`
7. **SSE event arrives** → Redis Pub/Sub delivers to all backend instances → client receives toast → click calls `focusWindow(id)`
8. **Window crashes** → `ErrorBoundary` catches, renders fallback, OS kernel alive

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
@keyframes windowOpen {
  from { opacity: 0; transform: scale(0.92) translateY(8px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}

@keyframes windowMinimize {
  to { opacity: 0; transform: scale(0.08) translate(var(--dock-target-x), var(--dock-target-y)); }
}

@keyframes launchpadIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.window {
  will-change: transform, opacity;
  transform: translate(var(--win-x, 0px), var(--win-y, 0px));
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

### [FIX #2] Drag & Drop — Strict Two-Phase Architecture

**Dragging is a purely local DOM operation. Zustand is NOT involved during drag.**

```
pointermove → RAF → el.style.setProperty('--win-x', x) → GPU composite
                                    ↑
                         NO React re-renders
                         NO Zustand calls
                         NO setState

pointerup → updateWindowPosition(id, { x, y })  ← SINGLE Zustand call to persist
```

Implementation in `<WindowNode />`:

```typescript
const dragRef = useRef<{ startX: number; startY: number; initX: number; initY: number } | null>(null);
const nodeRef = useRef<HTMLDivElement>(null);

const onPointerDown = (e: React.PointerEvent) => {
  const w = windows[id];
  dragRef.current = {
    startX: e.clientX,
    startY: e.clientY,
    initX: w.coordinates.x,
    initY: w.coordinates.y,
  };
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp, { once: true });
};

const onPointerMove = (e: PointerEvent) => {
  if (!dragRef.current || !nodeRef.current) return;
  const dx = e.clientX - dragRef.current.startX;
  const dy = e.clientY - dragRef.current.startY;
  const x = dragRef.current.initX + dx;
  const y = dragRef.current.initY + dy;

  // DOM-only update — zero React involvement
  requestAnimationFrame(() => {
    nodeRef.current!.style.setProperty('--win-x', `${x}px`);
    nodeRef.current!.style.setProperty('--win-y', `${y}px`);
  });
};

const onPointerUp = (e: PointerEvent) => {
  if (!dragRef.current) return;
  window.removeEventListener('pointermove', onPointerMove);
  const dx = e.clientX - dragRef.current.startX;
  const dy = e.clientY - dragRef.current.startY;

  // Single Zustand write to persist final position
  updateWindowPosition(id, {
    x: dragRef.current.initX + dx,
    y: dragRef.current.initY + dy,
  });
  dragRef.current = null;
};
```

This guarantees 60fps dragging regardless of window count. React reconciler is never invoked during drag.

---

## 3. React Component Architecture

```
<GammaOS />                          # Root kernel. SSE hook. OS-level ErrorBoundary.
├── <Desktop />                      # Wallpaper. Launchpad blur class.
├── <Launchpad />                    # Always mounted. visibility toggled.
│   └── <AppIcon /> × N             # onClick → openWindow(appId)
├── <WindowManager />                # Maps store.windows → WindowNode. Pure renderer.
│   └── <ErrorBoundary key={id}>    # Per-window. Resets on re-open via key change.
│       └── <WindowNode id={id} />  # Drag via local ref. Focus via selector.
│           ├── <TitleBar />        # Traffic lights. Drag handle (onPointerDown).
│           └── <AppContent />      # Dynamic import by appId.
├── <Dock />                         # Fixed bottom. Icons + minimized slots.
│   ├── <DockIcon appId />
│   └── <DockMinimizedSlot id />    # onClick → focusWindow(id)
└── <NotificationCenter />           # SSE toast queue.
    └── <ToastNotification />
```

**Focus detection per window — zero N re-renders:**
```typescript
// Inside <WindowNode id={id} />
// Only THIS component re-renders when focus changes — not all windows
const isFocused = useOSStore(s => s.focusedWindowId === id);
```

---

## 4. Global State Management (Zustand & TypeScript) — REVISED

### [FIX #1] WindowNode Interface — `isFocused` Removed

**Problem:** Storing `isFocused` inside each `WindowNode` meant `focusWindow` had to iterate all windows (`O(N)` mutations), causing React to re-render every mounted `<WindowNode />` on every focus change.

**Solution:** `focusedWindowId` is a scalar at the store root. Only the two affected windows re-render (the previously focused, now unfocused — and the newly focused one) via Zustand's equality selector.

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
  // ❌ REMOVED: isFocused — was causing O(N) re-renders
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
  // Window state
  windows: Record<string, WindowNode>;
  zIndexCounter: number;
  focusedWindowId: string | null;   // ✅ scalar — O(1) focus, O(1) re-render

  // UI state
  launchpadOpen: boolean;

  // Notification state
  notifications: Notification[];
  toastQueue: Notification[];

  // Window actions
  openWindow: (appId: string, title: string) => void;
  closeWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  maximizeWindow: (id: string) => void;
  updateWindowPosition: (id: string, coords: WindowCoordinates) => void;
  updateWindowDimensions: (id: string, dims: WindowDimensions) => void;

  // UI actions
  toggleLaunchpad: () => void;
  closeLaunchpad: () => void;

  // Notification actions
  pushNotification: (n: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void;
  dismissToast: (id: string) => void;
}
```

### Zustand Store — Revised Implementation

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
    focusedWindowId: null,          // ✅ scalar, not per-window boolean
    launchpadOpen: false,
    notifications: [],
    toastQueue: [],

    openWindow: (appId, title) => set(state => {
      const id = uuid();
      const z = state.zIndexCounter + 1;
      // ✅ No forEach mutation — only two state writes: new window + focusedWindowId
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
      state.focusedWindowId = id;   // ✅ O(1), triggers re-render only in selector consumers
    }),

    closeWindow: (id) => set(state => {
      delete state.windows[id];
      if (state.focusedWindowId === id) {
        // Focus most recently opened remaining window
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
      state.focusedWindowId = id;   // ✅ single scalar write
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

    // ⚠️ Called ONLY on pointerup (drag end) — never on pointermove
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

Monotonically incrementing counter. Each `focusWindow` / `openWindow` increments by 1 and assigns to the target window only. **O(1) — no sorting, no array scans.**

### Re-render Guarantee

| Action | Windows that re-render |
|---|---|
| `openWindow` | 1 (new window) + scalar `focusedWindowId` consumers |
| `focusWindow(id)` | 1 (focused window's `zIndex`) + `focusedWindowId` consumers |
| `pointermove` (drag) | 0 — DOM only via RAF |
| `pointerup` (drag end) | 1 (coordinates update) |
| `pushNotification` | 0 windows — NotificationCenter only |

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

`key={windowId}` on ErrorBoundary — automatic reset on window re-open.

### Minimized Window Lifecycle

```
OPEN      → mounted, visible,  pointer-events: auto
MINIMIZED → mounted, hidden,   pointer-events: none   (visibility: hidden)
CLOSED    → unmounted, removed from store
```

`visibility: hidden` keeps WebSocket, WebGL context, and component state alive. `display: none` would destroy them.

---

## 6. Backend Contracts — REVISED (Redis-backed SSE)

### [FIX #3] Anti-Pattern Eliminated: In-Memory → Redis

**Problem:** `const eventLog: SSEEvent[] = []` in a single Node.js process:
- Destroyed on process restart
- Not shared across cluster instances (PM2 cluster, Kubernetes pods)
- Memory leak without TTL enforcement

**Solution:** Redis as the shared event bus and persistent event log.

```
Node Instance A ──┐
Node Instance B ──┼──► Redis Pub/Sub (gamma:system:events)
Node Instance C ──┘         │
                            │ publish
                            ▼
                    All subscribers receive event
                    All active SSE clients notified
                            │
                    Redis ZSET (gamma:events:log)
                    score = eventId, TTL = 24h
                    Supports Last-Event-ID replay
                    across restarts and instances
```

### Redis Data Structures

```
gamma:events:log    → ZSET
  score: event.id (integer, monotonic)
  member: JSON.stringify(event)
  TTL strategy: ZREMRANGEBYSCORE to purge events older than 24h

gamma:events:counter → STRING (INCR for atomic event ID generation)

gamma:system:events  → Pub/Sub channel
```

### Node.js SSE Implementation (Redis-backed)

```typescript
// events/systemBus.ts
import { createClient } from 'redis';

const publisher = createClient({ url: process.env.REDIS_URL });
const subscriber = createClient({ url: process.env.REDIS_URL });
const dataClient  = createClient({ url: process.env.REDIS_URL });

await Promise.all([publisher.connect(), subscriber.connect(), dataClient.connect()]);

const CHANNEL    = 'gamma:system:events';
const LOG_KEY    = 'gamma:events:log';
const COUNTER_KEY = 'gamma:events:counter';
const LOG_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export interface SSEEvent {
  id: number;
  type: 'notification' | 'agent_status' | 'system_alert';
  payload: object;
  ts: number; // unix ms — used for TTL pruning
}

// Emit from any backend service (all instances receive it)
export async function emitSystemEvent(type: string, payload: object): Promise<void> {
  const id = await dataClient.incr(COUNTER_KEY); // atomic, cluster-safe
  const event: SSEEvent = { id, type, payload, ts: Date.now() };
  const serialized = JSON.stringify(event);

  await Promise.all([
    // Persist to ZSET for Last-Event-ID replay
    dataClient.zAdd(LOG_KEY, { score: id, value: serialized }),
    // Prune events older than 24h
    dataClient.zRemRangeByScore(LOG_KEY, 0, Date.now() - LOG_TTL_MS),
    // Broadcast to all connected instances
    publisher.publish(CHANNEL, serialized),
  ]);
}
```

```typescript
// routes/events.ts
import { Response, Request } from 'express';

app.get('/api/v1/system/events', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // --- Last-Event-ID replay (robust across restarts and instances) ---
  const lastId = parseInt(req.headers['last-event-id'] as string ?? '0');
  if (lastId > 0) {
    // Fetch all events with id > lastId from Redis ZSET
    const missed = await dataClient.zRangeByScore(LOG_KEY, lastId + 1, '+inf');
    for (const raw of missed) {
      sendSSE(res, JSON.parse(raw) as SSEEvent);
    }
  }

  // --- Heartbeat ---
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);

  // --- Subscribe to Redis Pub/Sub ---
  // Each SSE connection gets its own subscriber client
  const sub = subscriber.duplicate();
  await sub.connect();

  await sub.subscribe(CHANNEL, (raw: string) => {
    sendSSE(res, JSON.parse(raw) as SSEEvent);
  });

  req.on('close', async () => {
    clearInterval(heartbeat);
    await sub.unsubscribe(CHANNEL);
    await sub.disconnect();
  });
});

function sendSSE(res: Response, event: SSEEvent): void {
  res.write(`id: ${event.id}\n`);
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event.payload)}\n\n`);
}
```

### Cluster Topology — Why This Works

| Scenario | In-Memory (old) | Redis-backed (new) |
|---|---|---|
| Single node restart | ❌ eventLog lost | ✅ ZSET persists |
| PM2 cluster (4 instances) | ❌ each has own log | ✅ shared Pub/Sub + ZSET |
| Kubernetes rolling deploy | ❌ split-brain | ✅ all pods share Redis |
| Last-Event-ID replay | ❌ after restart | ✅ always reliable |
| Memory leak | ❌ unbounded array | ✅ TTL auto-prune |

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

### SSE Event Payload Contracts

```typescript
interface NotificationPayload {
  appId: string;
  title: string;
  body: string;
  priority: 'low' | 'normal' | 'high';
}

// Wire format:
// id: 42
// event: notification
// data: {"appId":"agent-monitor","title":"Agent Finished","body":"Task completed in 3.2s","priority":"normal"}
```

### Client-Side SSE Hook

```typescript
// hooks/useSystemEvents.ts
export function useSystemEvents() {
  const pushNotification = useOSStore(s => s.pushNotification);

  useEffect(() => {
    const connect = () => {
      // Browser automatically sends Last-Event-ID header on reconnect
      // when server sets id: in the stream — zero extra client code
      const es = new EventSource('/api/v1/system/events');

      es.addEventListener('notification', (e: MessageEvent) => {
        const payload: NotificationPayload = JSON.parse(e.data);
        pushNotification({ appId: payload.appId, title: payload.title, body: payload.body });
      });

      es.onerror = () => {
        es.close();
        setTimeout(connect, 3_000); // exponential backoff can be added
      };

      return es;
    };

    const es = connect();
    return () => es.close();
  }, []);
}
```

---

## Architectural Decision Log

| # | Decision | Rationale |
|---|---|---|
| 1 | `focusedWindowId` scalar in store | Eliminates O(N) re-renders on focus change |
| 2 | Drag via local Ref + RAF, Zustand only on `pointerup` | Guarantees 60fps drag, zero React involvement during motion |
| 3 | Redis Pub/Sub + ZSET for SSE bus | Stateless backend, multi-instance safe, Last-Event-ID reliable across restarts |
| 4 | `visibility: hidden` for minimized windows | Preserves WebSocket, WebGL, local state — no remount cost |
| 5 | ErrorBoundary `key={windowId}` | Auto-reset on re-open, no stale error state |
| 6 | Monotonic Z-index counter | O(1) focus, no sorting, practically unbounded |

---

*Gamma OS Phase 1 Spec v2 — revised 2026-03-08*
