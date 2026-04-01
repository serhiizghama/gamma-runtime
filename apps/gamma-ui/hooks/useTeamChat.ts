import { useCallback, useEffect, useRef, useState } from "react";
import { useSecureSse } from "./useSecureSse";
import { useTeams } from "./useTeams";
import { useSyndicateStore } from "../store/syndicate.store";
import { systemAuthHeaders } from "../lib/auth";
import { API_BASE } from "../constants/api";
import { useAgentStream } from "./useAgentStream";
import type { ActivityEvent } from "@gamma/types";

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
  messages: ReturnType<typeof useAgentStream>["messages"];
  teamName: string;
  members: TeamMember[];
  isConnected: boolean;
  sendMessage: (text: string) => void;
  squadLeaderId: string | null;
  agentStatuses: Record<string, AgentLiveStatus>;
  status: ReturnType<typeof useAgentStream>["status"];
  pendingToolLines: ReturnType<typeof useAgentStream>["pendingToolLines"];
}

// ── Constants ──────────────────────────────────────────────────────────────

// Status events that feed the header indicators but not the message list
const STATUS_KINDS = new Set<string>([
  "agent_status_change",
  "task_status_change",
]);

// ── Hook ───────────────────────────────────────────────────────────────────

export function useTeamChat(teamId: string): UseTeamChatResult {
  const [agentStatuses, setAgentStatuses] = useState<Record<string, AgentLiveStatus>>({});

  // windowId resolved after first sendMessage or on mount
  const [windowId, setWindowId] = useState<string | null>(null);
  const windowIdRef = useRef<string | null>(null);

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

  // Find squad leader
  const squadLeaderId =
    agents.find(
      (a) =>
        a.teamName === teamName &&
        (a.roleId === "squad-leader" ||
          a.name.toLowerCase().includes("squad leader") ||
          a.name.toLowerCase().includes("lead")),
    )?.id ??
    (teamMembers.length > 0 ? teamMembers[0].id : null);

  // Resolve windowId on mount — try to find existing active session for the leader
  useEffect(() => {
    if (!squadLeaderId || windowIdRef.current) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/sessions/active`, {
          headers: systemAuthHeaders(),
        });
        if (!res.ok || cancelled) return;
        const sessions = (await res.json()) as Array<{
          sessionKey: string;
          windowId: string;
        }>;
        const existing = sessions.find((s) => s.sessionKey === squadLeaderId);
        if (existing && !cancelled) {
          windowIdRef.current = existing.windowId;
          setWindowId(existing.windowId);
        }
      } catch {
        // best-effort
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [squadLeaderId]);

  // ── Reuse useAgentStream (same as ArchitectWindow / WindowNode) ────────
  // Pass empty string when no windowId yet — useAgentStream guards against "" internally
  // and will not open any SSE connection until windowId is resolved.
  const agentStream = useAgentStream(windowId ?? "", {
    onSessionMissing: () => {
      // Session was evicted from Redis — reset windowId so next send recreates it
      windowIdRef.current = null;
      setWindowId(null);
    },
  });

  // Activity stream for IPC status indicators in header
  const handleActivityMessage = useCallback((ev: MessageEvent) => {
    try {
      const event = JSON.parse(ev.data as string) as ActivityEvent;
      if (!event.id || !event.kind) return;

      if (STATUS_KINDS.has(event.kind)) {
        if (
          event.kind === "agent_status_change" &&
          memberIdsRef.current.has(event.agentId)
        ) {
          const rawPayload = event.payload;
          const status = (
            typeof rawPayload === "string" ? rawPayload : ""
          ) as AgentLiveStatus;
          setAgentStatuses((prev) => ({
            ...prev,
            [event.agentId]: status || "unknown",
          }));
        }
      }
    } catch {
      // ignore malformed
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useSecureSse({
    path: "/api/system/activity/stream",
    onMessage: handleActivityMessage,
    reconnectMs: 3000,
    label: "TeamChatActivity",
    enabled: teamMembers.length > 0,
  });

  // Send message — POST to /api/teams/:id/message which now returns windowId
  const sendMessage = useCallback(
    async (text: string) => {
      if (!squadLeaderId || !text.trim()) return;

      try {
        const res = await fetch(`${API_BASE}/api/teams/${teamId}/message`, {
          method: "POST",
          headers: { ...systemAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        });

        if (!res.ok) {
          console.warn("[TeamChat] POST failed:", res.status);
          return;
        }

        const data = (await res.json()) as {
          ok: boolean;
          leaderId?: string;
          leaderName?: string;
          windowId?: string;
        };

        // Backend now returns windowId — update immediately so SSE connects BEFORE the response arrives
        if (data.ok && data.windowId && data.windowId !== windowIdRef.current) {
          windowIdRef.current = data.windowId;
          setWindowId(data.windowId);
        }
      } catch (err) {
        console.warn("[TeamChat] Failed to send message:", err);
      }
    },
    [squadLeaderId, teamId],
  );

  return {
    messages: agentStream.messages,
    teamName,
    members: teamMembers,
    isConnected: agentStream.status !== "error" && !!windowId,
    sendMessage,
    squadLeaderId,
    agentStatuses,
    status: agentStream.status,
    pendingToolLines: agentStream.pendingToolLines,
  };
}
