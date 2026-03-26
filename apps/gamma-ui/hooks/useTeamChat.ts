import { useCallback, useEffect, useRef, useState } from "react";
import { useSecureSse } from "./useSecureSse";
import { useTeams } from "./useTeams";
import { useSyndicateStore } from "../store/syndicate.store";
import { systemAuthHeaders } from "../lib/auth";
import { API_BASE } from "../constants/api";
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

interface UseTeamChatResult {
  messages: TeamMessage[];
  teamName: string;
  members: TeamMember[];
  isConnected: boolean;
  sendMessage: (text: string) => void;
  squadLeaderId: string | null;
}

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_MESSAGES = 200;

const RELEVANT_KINDS = new Set<string>([
  "ipc_message_sent",
  "ipc_task_completed",
  "ipc_task_failed",
  "agent_status_change",
  "task_status_change",
]);

// ── Hook ───────────────────────────────────────────────────────────────────

export function useTeamChat(teamId: string): UseTeamChatResult {
  const [messages, setMessages] = useState<TeamMessage[]>([]);
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
    const payload = event.payload ?? "";

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
          text: `Delegated task to ${targetLabel}: "${payload || "..."}"`,
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
          text: `Completed: ${payload || "task finished"}`,
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
          text: `Failed: ${payload || "task failed"}`,
          timestamp: event.ts,
          type: "failure",
        };
      case "agent_status_change":
        return {
          id: event.id,
          agentId,
          agentName: info.name,
          agentEmoji: info.emoji,
          agentColor: info.color,
          text: `is now ${payload || "unknown"}`,
          timestamp: event.ts,
          type: "status",
        };
      case "task_status_change":
        return {
          id: event.id,
          agentId,
          agentName: info.name,
          agentEmoji: info.emoji,
          agentColor: info.color,
          text: `Task moved to ${payload || "unknown status"}`,
          timestamp: event.ts,
          type: "status",
        };
      default:
        return null;
    }
  }

  // SSE message handler
  const handleMessage = useCallback((ev: MessageEvent) => {
    try {
      const event = JSON.parse(ev.data as string) as ActivityEvent;
      if (!event.id || !event.kind) return;
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

  const { connected } = useSecureSse({
    path: "/api/system/activity/stream",
    onMessage: handleMessage,
    reconnectMs: 3000,
    label: "TeamChat",
    enabled: teamMembers.length > 0,
  });

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
      fetch(`${API_BASE}/api/teams/${teamId}/message`, {
        method: "POST",
        headers: { ...systemAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
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
    isConnected: connected,
    sendMessage,
    squadLeaderId,
  };
}
