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
  clearFlash: (source: string, target: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function toLiveStatus(
  s: string,
): SyndicateAgent["liveStatus"] {
  if (s === "running" || s === "idle" || s === "error" || s === "aborted") return s;
  return "offline";
}

const IPC_FLASH_DURATION = 1200; // ms — matches CSS animation duration

// ── Store ─────────────────────────────────────────────────────────────────

export const useSyndicateStore = create<SyndicateStore>((set, get) => ({
  agents: [],
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

      set({ agents, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch agents",
      });
    }
  },

  applyRegistryUpdate: (entries) => {
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

    // IPC message → flash edge
    if (event.kind === "ipc_message_sent" && event.agentId && event.targetAgentId) {
      const flash: IpcFlash = {
        source: event.agentId,
        target: event.targetAgentId,
        ts: Date.now(),
      };
      set((s) => ({ ipcFlashes: [...s.ipcFlashes, flash] }));

      // Auto-expire
      setTimeout(() => {
        get().clearFlash(flash.source, flash.target);
      }, IPC_FLASH_DURATION);
    }
  },

  selectAgent: (id) => set({ selectedAgentId: id }),

  clearFlash: (source, target) => {
    set((s) => ({
      ipcFlashes: s.ipcFlashes.filter(
        (f) => !(f.source === source && f.target === target),
      ),
    }));
  },
}));

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
