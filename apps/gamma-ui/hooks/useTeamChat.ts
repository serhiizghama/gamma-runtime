import { useCallback, useEffect, useRef, useState } from "react";
import { useSecureSse } from "./useSecureSse";
import { useTeams } from "./useTeams";
import { useSyndicateStore } from "../store/syndicate.store";
import { systemAuthHeaders } from "../lib/auth";
import { fetchSseTicket } from "../lib/auth";
import { API_BASE } from "../constants/api";
import type { ActivityEvent, GammaSSEEvent } from "@gamma/types";

// ── Types ──────────────────────────────────────────────────────────────────

export interface TeamMessage {
  id: string;
  agentId: string;
  agentName: string;
  agentEmoji: string;
  agentColor: string;
  text: string;
  timestamp: number;
  type: "delegation" | "completion" | "failure" | "status" | "user";
}

export interface TeamMember {
  id: string;
  name: string;
  emoji: string;
  uiColor: string;
}

export type AgentLiveStatus = "running" | "idle" | "error" | "unknown";

interface UseTeamChatResult {
  messages: TeamMessage[];
  teamName: string;
  members: TeamMember[];
  /** true when Squad Leader SSE stream is active (primary connection) */
  isConnected: boolean;
  sendMessage: (text: string) => void;
  squadLeaderId: string | null;
  /** Live status per agentId — used to drive header indicators */
  agentStatuses: Record<string, AgentLiveStatus>;
}

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_MESSAGES = 200;

// Status-only events are shown as agent indicators in the header — NOT as chat bubbles
const RELEVANT_KINDS = new Set<string>([
  "ipc_message_sent",
  "ipc_task_completed",
  "ipc_task_failed",
]);

// Status events that feed the header indicators but not the message list
const STATUS_KINDS = new Set<string>([
  "agent_status_change",
  "task_status_change",
]);

// ── Hook ───────────────────────────────────────────────────────────────────

export function useTeamChat(teamId: string): UseTeamChatResult {
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [agentStatuses, setAgentStatuses] = useState<Record<string, AgentLiveStatus>>({});
  const seenIdsRef = useRef<Set<string>>(new Set());

  // Get team info
  const { teams } = useTeams();
  const team = teams.find((t) => t.id === teamId);
  const teamName = team?.name ?? "Team";

  // Get agent details from syndicate store
  const agents = useSyndicateStore((s) => s.agents);
  const teamMembers: TeamMember[] = agents
    .filter((a) => a.teamName === teamName)
    .map((a) => ({
      id: a.id,
      name: a.name,
      emoji: a.avatarEmoji,
      uiColor: a.uiColor,
    }));

  const memberIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    memberIdsRef.current = new Set(teamMembers.map((m) => m.id));
  }, [teamMembers]);

  // Find squad leader (first agent whose roleId or name suggests leader)
  const squadLeaderId =
    agents.find(
      (a) =>
        a.teamName === teamName &&
        (a.roleId === "squad-leader" ||
          a.name.toLowerCase().includes("squad leader") ||
          a.name.toLowerCase().includes("lead")),
    )?.id ??
    (teamMembers.length > 0 ? teamMembers[0].id : null);

  // Agent lookup helper
  const agentMapRef = useRef<Map<string, TeamMember>>(new Map());
  useEffect(() => {
    const m = new Map<string, TeamMember>();
    for (const member of teamMembers) {
      m.set(member.id, member);
    }
    agentMapRef.current = m;
  }, [teamMembers]);

  function getAgentInfo(agentId: string): {
    name: string;
    emoji: string;
    color: string;
  } {
    const member = agentMapRef.current.get(agentId);
    if (member) return { name: member.name, emoji: member.emoji, color: member.uiColor };
    // Fallback for unknown agents
    return { name: agentId, emoji: "🤖", color: "#6366f1" };
  }

  // Convert activity event to chat message
  function eventToMessage(event: ActivityEvent): TeamMessage | null {
    const agentId = event.agentId;
    if (!memberIdsRef.current.has(agentId) && !memberIdsRef.current.has(event.targetAgentId ?? "")) {
      return null;
    }

    const info = getAgentInfo(agentId);

    // Safely extract human-readable text from payload.
    // ipc_task_completed/failed payloads are JSON: {"taskId","status","message","data"}
    // ipc_message_sent payloads are plain strings or JSON with description.
    const rawPayload = event.payload;
    let payloadText = "";
    if (rawPayload != null) {
      if (typeof rawPayload === "string") {
        // Try to parse as JSON and extract message/description field
        try {
          const parsed = JSON.parse(rawPayload) as Record<string, unknown>;
          payloadText = (parsed.message as string) || (parsed.description as string) || rawPayload;
        } catch {
          payloadText = rawPayload;
        }
      } else if (typeof rawPayload === "object") {
        const obj = rawPayload as Record<string, unknown>;
        payloadText = (obj.message as string) || (obj.description as string) || JSON.stringify(rawPayload);
      }
    }

    switch (event.kind) {
      case "ipc_message_sent": {
        const targetInfo = event.targetAgentId ? getAgentInfo(event.targetAgentId) : null;
        const targetLabel = targetInfo ? `${targetInfo.emoji} ${targetInfo.name}` : "unknown";
        return {
          id: event.id,
          agentId,
          agentName: info.name,
          agentEmoji: info.emoji,
          agentColor: info.color,
          text: `Delegated to ${targetLabel}: "${payloadText || "..."}"`,
          timestamp: event.ts,
          type: "delegation",
        };
      }
      case "ipc_task_completed":
        return {
          id: event.id,
          agentId,
          agentName: info.name,
          agentEmoji: info.emoji,
          agentColor: info.color,
          text: payloadText || "Task completed",
          timestamp: event.ts,
          type: "completion",
        };
      case "ipc_task_failed":
        return {
          id: event.id,
          agentId,
          agentName: info.name,
          agentEmoji: info.emoji,
          agentColor: info.color,
          text: `Failed: ${payloadText || "task failed"}`,
          timestamp: event.ts,
          type: "failure",
        };
      // agent_status_change and task_status_change are handled separately
      // via setAgentStatuses — they do NOT appear as chat messages
      default:
        return null;
    }
  }

  // SSE message handler
  const handleMessage = useCallback((ev: MessageEvent) => {
    try {
      const event = JSON.parse(ev.data as string) as ActivityEvent;
      if (!event.id || !event.kind) return;

      // Status events → update header indicators only, never show as chat messages
      if (STATUS_KINDS.has(event.kind)) {
        if (event.kind === "agent_status_change" && memberIdsRef.current.has(event.agentId)) {
          const rawPayload = event.payload;
          const status = (typeof rawPayload === "string" ? rawPayload : "") as AgentLiveStatus;
          setAgentStatuses((prev) => ({ ...prev, [event.agentId]: status || "unknown" }));
        }
        return;
      }

      if (!RELEVANT_KINDS.has(event.kind)) return;
      if (seenIdsRef.current.has(event.id)) return;
      seenIdsRef.current.add(event.id);

      const msg = eventToMessage(event);
      if (!msg) return;

      setMessages((prev) => {
        const next = [...prev, msg];
        if (next.length > MAX_MESSAGES) {
          const evicted = next.slice(0, next.length - MAX_MESSAGES);
          for (const e of evicted) seenIdsRef.current.delete(e.id);
          return next.slice(-MAX_MESSAGES);
        }
        return next;
      });
    } catch {
      // Ignore malformed messages
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to activity stream for ipc events (delegation, completion, failure)
  useSecureSse({
    path: "/api/system/activity/stream",
    onMessage: handleMessage,
    reconnectMs: 3000,
    label: "TeamChat",
    enabled: teamMembers.length > 0,
  });

  // ── Squad Leader SSE stream ────────────────────────────────────────
  //
  // Design:
  //  - Resolves windowId from /api/sessions/active on every (re)connect
  //  - Does NOT close a healthy connection on sendMessage — avoids race
  //    where reconnect gap causes missed assistant_delta events
  //  - Exposes leaderConnected state for UI (separate from activity stream)
  //
  const leaderStreamRef = useRef<EventSource | null>(null);
  const squadLeaderIdRef = useRef<string | null>(null);
  const reconnectNowRef = useRef<(() => void) | null>(null);
  const [leaderConnected, setLeaderConnected] = useState(false);

  useEffect(() => {
    squadLeaderIdRef.current = squadLeaderId;
  }, [squadLeaderId]);

  useEffect(() => {
    if (!squadLeaderId) return;

    let destroyed = false;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let currentWindowId: string | null = null;
    let currentAnswerText = "";
    let currentAnswerId: string | null = null;

    async function resolveWindowId(): Promise<string | null> {
      try {
        const res = await fetch(`${API_BASE}/api/sessions/active`, { headers: systemAuthHeaders() });
        if (!res.ok) return null;
        const sessions = (await res.json()) as Array<{ sessionKey: string; windowId: string }>;
        return sessions.find((s) => s.sessionKey === squadLeaderIdRef.current)?.windowId ?? null;
      } catch { return null; }
    }

    async function connect() {
      if (destroyed) return;

      const windowId = await resolveWindowId();
      if (!windowId || destroyed) {
        // No active session yet — retry after 2s
        reconnectTimer = setTimeout(connect, 2000);
        return;
      }

      // Already connected to the same healthy windowId — nothing to do
      if (windowId === currentWindowId && es && es.readyState === EventSource.OPEN) {
        return;
      }

      // Close old connection only if switching windowId
      if (es && windowId !== currentWindowId) {
        es.close();
        es = null;
        currentAnswerText = "";
        currentAnswerId = null;
      }

      currentWindowId = windowId;

      const ticket = await fetchSseTicket(`/api/stream/${windowId}`);
      if (destroyed) return;

      const newEs = new EventSource(`${API_BASE}/api/stream/${windowId}${ticket}`);
      es = newEs;
      leaderStreamRef.current = es;

      newEs.onopen = () => {
        if (!destroyed) setLeaderConnected(true);
      };

      newEs.onmessage = (ev) => {
        if (destroyed) return;
        try {
          const event = JSON.parse(ev.data) as GammaSSEEvent;
          const leaderId = squadLeaderIdRef.current;
          if (!leaderId) return;

          if (event.type === "keep_alive") return;

          if (event.type === "assistant_delta" || event.type === "assistant_update") {
            currentAnswerText = event.text ?? "";
            if (!currentAnswerId) {
              currentAnswerId = `leader-ans-${Date.now()}`;
              const msgId = currentAnswerId;
              const info = getAgentInfo(leaderId);
              setMessages((prev) => [...prev, {
                id: msgId,
                agentId: leaderId,
                agentName: info.name,
                agentEmoji: info.emoji,
                agentColor: info.color,
                text: currentAnswerText,
                timestamp: Date.now(),
                type: "completion",
              }]);
            } else {
              const msgId = currentAnswerId;
              setMessages((prev) => prev.map((m) =>
                m.id === msgId ? { ...m, text: currentAnswerText } : m
              ));
            }
          }

          if (event.type === "lifecycle_end") {
            // Reset per-run state but keep SSE connection alive
            currentAnswerText = "";
            currentAnswerId = null;
          }
        } catch { /* ignore malformed */ }
      };

      newEs.onerror = () => {
        if (destroyed) return;
        newEs.close();
        if (es === newEs) { es = null; leaderStreamRef.current = null; }
        setLeaderConnected(false);
        // Reconnect: resolve fresh windowId in case session was recreated
        reconnectTimer = setTimeout(connect, 3000);
      };
    }

    // After sendMessage POST: only reconnect if not already connected
    reconnectNowRef.current = () => {
      if (es && es.readyState === EventSource.OPEN) return; // already connected
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      void connect();
    };

    connect();

    return () => {
      destroyed = true;
      setLeaderConnected(false);
      reconnectNowRef.current = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
      leaderStreamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [squadLeaderId]);

  // Send message to squad leader
  const sendMessage = useCallback(
    (text: string) => {
      if (!squadLeaderId || !text.trim()) return;

      // Add user message locally
      const userMsg: TeamMessage = {
        id: `user-${Date.now()}`,
        agentId: "user",
        agentName: "You",
        agentEmoji: "👤",
        agentColor: "#60a5fa",
        text,
        timestamp: Date.now(),
        type: "user",
      };
      setMessages((prev) => [...prev, userMsg]);

      // Send via team message endpoint (activates leader + delivers via Gateway)
      // After POST completes, immediately reconnect SSE to pick up the fresh windowId
      // that openAgentSession creates — this prevents the race where the agent
      // responds before we've connected to the new stream.
      fetch(`${API_BASE}/api/teams/${teamId}/message`, {
        method: "POST",
        headers: { ...systemAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      }).then(() => {
        // POST done → session is now active with a fresh windowId → reconnect immediately
        reconnectNowRef.current?.();
      }).catch((err) => {
        console.warn("[TeamChat] Failed to send message:", err);
      });
    },
    [squadLeaderId],
  );

  return {
    messages,
    teamName,
    members: teamMembers,
    // Show Squad Leader SSE status (primary) — activity stream is secondary
    isConnected: leaderConnected,
    sendMessage,
    squadLeaderId,
    agentStatuses,
  };
}
