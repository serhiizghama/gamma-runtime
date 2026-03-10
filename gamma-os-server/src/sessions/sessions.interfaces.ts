import type { AgentStatus } from '../gateway/event-classifier';

/** Window↔Session mapping stored in gamma:sessions Redis Hash (spec §3.4) */
export interface WindowSession {
  windowId: string;
  appId: string;
  sessionKey: string;
  agentId: string;
  createdAt: number;
  status: AgentStatus;
}

/** POST /api/sessions request body */
export interface CreateSessionDto {
  windowId: string;
  appId: string;
  sessionKey: string;
  agentId: string;
}
