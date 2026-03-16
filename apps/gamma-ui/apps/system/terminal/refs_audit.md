# useRef Audit — gamma-ui (.tsx files)

> Generated: 2026-03-16 | Scope: `apps/gamma-ui/**/*.tsx` (excl. node_modules, dist, .bak_session)

---

## Components

### `components/Desktop.tsx`
| Ref | Type | Purpose |
|-----|------|---------|
| `canvasRef` | `HTMLCanvasElement` | Boot/background canvas rendering |

---

### `components/BootScreen.tsx`
| Ref | Type | Purpose |
|-----|------|---------|
| `canvasRef` | `HTMLCanvasElement` | Animated boot screen canvas |

---

### `components/MessageList.tsx`
| Ref | Type | Purpose |
|-----|------|---------|
| `containerRef` | `HTMLDivElement` | Scroll container reference |
| `bottomRef` | `HTMLDivElement` | Auto-scroll anchor (scroll-to-bottom) |

---

### `components/ToastNotification.tsx`
| Ref | Type | Purpose |
|-----|------|---------|
| `timerRef` | `ReturnType<typeof setTimeout>` | Auto-dismiss timer handle |

---

### `components/Portal.tsx`
| Ref | Type | Purpose |
|-----|------|---------|
| `containerRef` | `HTMLElement \| null` | DOM portal mount point |

---

### `components/WindowNode.tsx`
| Ref | Type | Purpose |
|-----|------|---------|
| `panelResizeRef` | `{ startY, startHeight }` | Drag-resize state snapshot |
| `shellRef` | `HTMLDivElement` | Shell panel DOM node |

---

### `components/ArchitectWindow.tsx`
| Ref | Type | Purpose |
|-----|------|---------|
| `busyRef` | `boolean` | Prevents re-entrant send |
| `containerRef` | `HTMLDivElement` | Resize drag target |
| `rafRef` | `number \| null` | requestAnimationFrame handle |
| `startXRef` | `number` | Drag start X position |
| `startWidthRef` | `number` | Drag start width snapshot |

---

### `components/ChatInput.tsx`
| Ref | Type | Purpose |
|-----|------|---------|
| `inputRef` | `HTMLInputElement` | Focus management on send |

---

## Apps (system/)

### `apps/system/terminal/TerminalApp.tsx`
| Ref | Type | Purpose |
|-----|------|---------|
| `containerRef` | `HTMLDivElement` | xterm mount container |
| `termRef` | `Terminal \| null` | xterm instance |
| `fitAddonRef` | `FitAddon \| null` | Fit addon for resize |
| `wsRef` | `WebSocket \| null` | PTY WebSocket connection |
| `wsTimeoutRef` | `ReturnType<typeof setTimeout> \| null` | WS connect timeout (cleared on open/close/unmount) |

---

### `apps/system/director/DirectorApp.tsx`
| Ref | Type | Purpose |
|-----|------|---------|
| `feedRef` | `HTMLDivElement` | Activity feed scroll container |
| `esRef` | `EventSource \| null` | SSE connection handle |
| `reconnectTimerRef` | `ReturnType<typeof setTimeout> \| null` | SSE reconnect timer |

---

### `apps/system/sentinel/SentinelApp.tsx`
| Ref | Type | Purpose |
|-----|------|---------|
| `lastFetchRef` | `number` | Timestamp of last fetch (throttle guard) |
| `mountedRef` | `boolean` | Mount guard (×2 scopes) — prevents setState after unmount |

---

### `apps/system/kernel-monitor/KernelMonitorApp.tsx`
| Ref | Type | Purpose |
|-----|------|---------|
| `logRef` | `HTMLDivElement` | Log panel scroll container |
| `esRef` | `EventSource \| null` | SSE stream handle |
| `logIdRef` | `number` | Monotonic ID counter for log entries |

---

## Summary

| Category | Files | Total refs |
|----------|-------|-----------|
| Components | 8 | 13 |
| System apps | 4 | 12 |
| **Total** | **12** | **25** |

### Patterns observed
- **DOM anchors** (`HTMLDivElement`, `HTMLCanvasElement`, `HTMLInputElement`) — most common, used for scroll, focus, canvas
- **Async handles** (`WebSocket`, `EventSource`, timers) — used in terminal, director, kernel-monitor; all properly nulled on cleanup
- **Mutable flags** (`busyRef`, `mountedRef`, `lastFetchRef`) — used to avoid stale closures and race conditions
- **Drag state** (`panelResizeRef`, `startXRef`, etc.) — values that shouldn't trigger re-render
