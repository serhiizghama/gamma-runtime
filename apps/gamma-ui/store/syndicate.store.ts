/**
 * syndicate.store.ts — Zustand store for the Syndicate Map.
 *
 * Manages:
 *  - Agent list (fetched from /api/agents, enriched with registry status)
 *  - Hierarchy edges (derived from supervisorId relationships)
 *  - Selected agent (for detail panel)
 *  - IPC flash set (edge animations triggered by activity events)
 */

import { create } from "zustand";
import type { AgentRegistryEntry, ActivityEvent, GammaSSEEvent } from "@gamma/types";
import { systemAuthHeaders } from "../lib/auth";
import { API_BASE } from "../constants/api";

// ── Types ─────────────────────────────────────────────────────────────────

/** Shape returned by GET /api/agents (AgentStateRecord from backend). */
export interface AgentRecord {
  id: string;
  name: string;
  roleId: string;
  avatarEmoji: string;
  uiColor: string;
  status: string;
  workspacePath: string;
  createdAt: number;
  updatedAt: number;
}

/** Merged agent info: static DB record + live registry entry. */
export interface SyndicateAgent {
  id: string;
  name: string;
  roleId: string;
  avatarEmoji: string;
  uiColor: string;
  /** Live runtime status from registry (falls back to DB status). */
  liveStatus: "running" | "idle" | "offline" | "error" | "aborted";
  supervisorId: string | null;
  inProgressTaskCount: number;
}

/** An IPC flash: source → target edge should animate. */
export interface IpcFlash {
  source: string;
  target: string;
  ts: number;
}

interface SyndicateStore {
  // ── State ─────────────────────────────────────────────────────────────
  agents: SyndicateAgent[];
  /** True after the first successful fetchAgents() call. */
  hydrated: boolean;
  /** Currently selected agent ID (opens detail panel). */
  selectedAgentId: string | null;
  /** Active IPC flashes (auto-expire after animation). */
  ipcFlashes: IpcFlash[];
  loading: boolean;
  error: string | null;

  // ── Actions ───────────────────────────────────────────────────────────
  fetchAgents: () => Promise<void>;
  applyRegistryUpdate: (entries: AgentRegistryEntry[]) => void;
  handleActivityEvent: (event: ActivityEvent) => void;
  selectAgent: (id: string | null) => void;
  /** Remove expired flashes. Called by the cleanup interval. */
  pruneFlashes: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function toLiveStatus(
  s: string,
): SyndicateAgent["liveStatus"] {
  if (s === "running" || s === "idle" || s === "error" || s === "aborted") return s;
  return "offline";
}

const IPC_FLASH_DURATION = 1200; // ms — matches CSS animation duration

/**
 * Queued SSE events that arrived before the initial fetch completed.
 * Replayed once after hydration. Module-scoped because the store factory
 * closure shouldn't hold mutable arrays.
 */
let pendingEvents: ActivityEvent[] = [];
let pendingRegistryUpdates: AgentRegistryEntry[][] = [];

// ── Store ─────────────────────────────────────────────────────────────────

export const useSyndicateStore = create<SyndicateStore>((set, get) => ({
  agents: [],
  hydrated: false,
  selectedAgentId: null,
  ipcFlashes: [],
  loading: false,
  error: null,

  fetchAgents: async () => {
    set({ loading: true, error: null });
    try {
      // Fetch static agent list from DB
      const agentsRes = await fetch(`${API_BASE}/api/agents`, {
        headers: systemAuthHeaders(),
      });
      if (!agentsRes.ok) throw new Error(`agents: ${agentsRes.status}`);
      const agentRecords = (await agentsRes.json()) as AgentRecord[];

      // Fetch live registry for status/hierarchy
      let registryMap = new Map<string, AgentRegistryEntry>();
      try {
        const regRes = await fetch(`${API_BASE}/api/system/agent-registry`, {
          headers: systemAuthHeaders(),
        });
        if (regRes.ok) {
          const entries = (await regRes.json()) as AgentRegistryEntry[];
          registryMap = new Map(entries.map((e) => [e.agentId, e]));
        }
      } catch {
        // Registry unavailable — proceed with DB status only
      }

      const agents: SyndicateAgent[] = agentRecords
        .filter((r) => r.status !== "archived")
        .map((r) => {
          const reg = registryMap.get(r.id);
          return {
            id: r.id,
            name: r.name,
            roleId: r.roleId,
            avatarEmoji: r.avatarEmoji,
            uiColor: r.uiColor,
            liveStatus: reg ? toLiveStatus(reg.status) : "offline",
            supervisorId: reg?.supervisorId ?? null,
            inProgressTaskCount: 0,
          };
        });

      set({ agents, loading: false, hydrated: true });

      // Replay any SSE events that arrived before hydration
      const queuedEvents = pendingEvents;
      const queuedRegistry = pendingRegistryUpdates;
      pendingEvents = [];
      pendingRegistryUpdates = [];

      for (const entries of queuedRegistry) {
        get().applyRegistryUpdate(entries);
      }
      for (const event of queuedEvents) {
        get().handleActivityEvent(event);
      }
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch agents",
      });
    }
  },

  applyRegistryUpdate: (entries) => {
    if (!get().hydrated) {
      pendingRegistryUpdates.push(entries);
      return;
    }
    const byId = new Map(entries.map((e) => [e.agentId, e]));
    set((s) => ({
      agents: s.agents.map((a) => {
        const reg = byId.get(a.id);
        if (!reg) return a;
        return {
          ...a,
          liveStatus: toLiveStatus(reg.status),
          supervisorId: reg.supervisorId ?? null,
        };
      }),
    }));
  },

  handleActivityEvent: (event) => {
    if (!get().hydrated) {
      pendingEvents.push(event);
      return;
    }

    // Status changes
    if (event.kind === "agent_status_change" && event.payload) {
      set((s) => ({
        agents: s.agents.map((a) =>
          a.id === event.agentId
            ? { ...a, liveStatus: toLiveStatus(event.payload!) }
            : a,
        ),
      }));
    }

    // IPC message → flash edge (timestamp-based expiry, cleaned by pruneFlashes)
    if (event.kind === "ipc_message_sent" && event.agentId && event.targetAgentId) {
      const flash: IpcFlash = {
        source: event.agentId,
        target: event.targetAgentId,
        ts: Date.now(),
      };
      set((s) => ({ ipcFlashes: [...s.ipcFlashes, flash] }));
    }
  },

  selectAgent: (id) => set({ selectedAgentId: id }),

  pruneFlashes: () => {
    const now = Date.now();
    set((s) => {
      const live = s.ipcFlashes.filter((f) => now - f.ts < IPC_FLASH_DURATION);
      // Skip setState if nothing changed — avoids unnecessary re-renders
      return live.length === s.ipcFlashes.length ? s : { ipcFlashes: live };
    });
  },
}));

// ── Flash cleanup interval ───────────────────────────────────────────────
// Single interval that prunes expired flashes. This replaces per-flash
// setTimeout calls which leaked when the component unmounted.

let flashIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Start the flash cleanup interval. Call once when SyndicateMap mounts.
 * Returns a cleanup function for the useEffect teardown.
 */
export function startFlashPruner(): () => void {
  if (flashIntervalId === null) {
    flashIntervalId = setInterval(() => {
      useSyndicateStore.getState().pruneFlashes();
    }, 400);
  }
  return () => {
    if (flashIntervalId !== null) {
      clearInterval(flashIntervalId);
      flashIntervalId = null;
    }
  };
}

// ── SSE event handler (called from useSecureSse onMessage callback) ──────

/**
 * Parse an SSE MessageEvent and route it to the appropriate store action.
 * Handles both broadcast registry updates and activity stream events.
 */
export function handleSyndicateSseEvent(ev: MessageEvent): void {
  try {
    const data = JSON.parse(ev.data as string) as Record<string, unknown>;
    if (data.type === "keep_alive") return;

    // Registry broadcast (from gamma:sse:broadcast)
    if (data.type === "agent_registry_update") {
      const event = data as unknown as GammaSSEEvent & { type: "agent_registry_update" };
      useSyndicateStore.getState().applyRegistryUpdate(event.agents);
      return;
    }

    // Activity event (from /api/system/activity/stream)
    if (data.kind) {
      useSyndicateStore.getState().handleActivityEvent(data as unknown as ActivityEvent);
    }
  } catch {
    // Ignore parse errors
  }
}
