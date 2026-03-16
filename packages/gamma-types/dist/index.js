"use strict";
/**
 * @gamma/types — Shared type definitions for Gamma Agent Runtime
 * Spec reference: Phase 2 Backend Integration Specification v1.4, §3
 *
 * Single source of truth for both frontend (React) and backend (NestJS).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.REDIS_KEYS = void 0;
// ── Redis Key Constants ──────────────────────────────────────────────────
exports.REDIS_KEYS = {
    SESSIONS: 'gamma:sessions',
    SSE_PREFIX: 'gamma:sse:',
    SSE_BROADCAST: 'gamma:sse:broadcast',
    MEMORY_BUS: 'gamma:memory:bus',
    APP_REGISTRY: 'gamma:app:registry',
    APP_DATA_PREFIX: 'gamma:app-data:',
    STATE_PREFIX: 'gamma:state:',
    EVENT_LAG: 'gamma:metrics:event_lag',
    SESSION_REGISTRY_PREFIX: 'gamma:session-registry:',
    SESSION_CONTEXT_PREFIX: 'gamma:session-context:',
    AGENT_REGISTRY_PREFIX: 'gamma:agent-registry:',
    AGENT_REGISTRY_INDEX: 'gamma:agent-registry:index',
    AGENT_BROADCAST: 'gamma:agent:broadcast',
    AGENT_INBOX: (agentId) => `gamma:agent:${agentId}:inbox`,
    SYSTEM_ACTIVITY: 'gamma:system:activity',
    SSE_TICKET_PREFIX: 'gamma:sse-ticket:',
};
//# sourceMappingURL=index.js.map