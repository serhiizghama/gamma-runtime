import { Injectable, Logger } from '@nestjs/common';
import { SessionRegistryService } from '../sessions/session-registry.service';
import { AgentRegistryService } from '../messaging/agent-registry.service';
import { SystemEventLog } from '../system/system-event-log.service';
import { SystemHealthService } from '../system/system-health.service';
import type { AgentRegistryEntry, SessionRecord, SystemHealthReport } from '@gamma/types';

/**
 * Dynamic Context Injector — aggregates real-time system state into a compact
 * text block that gets appended to agent system prompts before each message.
 *
 * This gives both System Architect and App Owner agents "Live Situational
 * Awareness" of the runtime environment: active sessions, recent events,
 * and host health metrics (CPU/RAM).
 */
@Injectable()
export class ContextInjectorService {
  private readonly logger = new Logger(ContextInjectorService.name);

  constructor(
    private readonly sessionRegistry: SessionRegistryService,
    private readonly agentRegistry: AgentRegistryService,
    private readonly eventLog: SystemEventLog,
    private readonly healthService: SystemHealthService,
  ) {}

  /**
   * Build a compact live-context block suitable for injection into agent prompts.
   * Best-effort: returns an empty string if aggregation fails entirely.
   */
  async getLiveContext(callerSessionKey?: string): Promise<string> {
    try {
      const [sessions, health, agents] = await Promise.all([
        this.sessionRegistry.getAll().catch(() => [] as SessionRecord[]),
        this.healthService.getHealth().catch(() => null as SystemHealthReport | null),
        this.agentRegistry.getAll().catch(() => [] as AgentRegistryEntry[]),
      ]);

      const recentEvents = this.eventLog.getAll().slice(0, 10);

      const lines: string[] = ['[LIVE SYSTEM STATE]'];

      // ── Active Sessions ──
      lines.push('');
      lines.push('Active Sessions:');
      if (sessions.length === 0) {
        lines.push('  (none)');
      } else {
        for (const s of sessions) {
          const tokens = s.tokenUsage
            ? ` | tokens: ${s.tokenUsage.inputTokens}in/${s.tokenUsage.outputTokens}out`
            : '';
          lines.push(
            `  - ${s.sessionKey} [${s.status}] runs=${s.runCount}${tokens}`,
          );
        }
      }

      // ── System Health ──
      if (health) {
        lines.push('');
        lines.push('System Health:');
        lines.push(`  Status: ${health.status}`);
        if (health.cpu.usagePct >= 0) {
          lines.push(`  CPU: ${health.cpu.usagePct}%`);
        }
        if (health.ram.usedMb >= 0) {
          lines.push(
            `  RAM: ${health.ram.usedMb}MB / ${health.ram.totalMb}MB (${health.ram.usedPct}%)`,
          );
        }
        lines.push(`  Redis: ${health.redis.connected ? 'connected' : 'disconnected'} (${health.redis.latencyMs}ms)`);
        lines.push(`  Gateway: ${health.gateway.connected ? 'connected' : 'disconnected'} (${health.gateway.latencyMs}ms)`);
        if (health.watchdog?.online !== undefined) {
          lines.push(`  Watchdog: ${health.watchdog.online ? 'online' : 'offline'}`);
        }
      }

      // ── Recent Events ──
      if (recentEvents.length > 0) {
        lines.push('');
        lines.push('Recent Events (newest first):');
        for (const evt of recentEvents) {
          const ts = new Date(evt.ts).toISOString().slice(11, 19); // HH:MM:SS
          lines.push(`  [${ts}] [${evt.type}] ${evt.message}`);
        }
      }

      // ── Hierarchy (Phase 5.4) ──
      if (callerSessionKey) {
        const self = agents.find((a) => a.sessionKey === callerSessionKey);
        if (self) {
          lines.push('');
          lines.push('[HIERARCHY]');
          if (self.supervisorId) {
            lines.push(`Your supervisor: ${self.supervisorId}`);
            lines.push('Prioritize their requests and report progress to them.');
          } else {
            lines.push('You are a root-level agent with no supervisor.');
          }
          const subordinates = agents.filter((a) => a.supervisorId === self.agentId);
          if (subordinates.length > 0) {
            lines.push(`Agents reporting to you: ${subordinates.map((s) => s.agentId).join(', ')}`);
            lines.push('You are responsible for overseeing their work. Delegate tasks via send_message.');
          }
          lines.push('[/HIERARCHY]');
        }
      }

      // ── Available Agents (IPC targets) ──
      const others = agents.filter(
        (a) => a.sessionKey !== callerSessionKey && a.status !== 'offline',
      );
      if (others.length > 0) {
        lines.push('');
        lines.push('Available Agents:');
        for (const a of others) {
          const ipc = a.acceptsMessages ? 'ipc=yes' : 'ipc=no';
          const sup = a.supervisorId ? ` | supervisor=${a.supervisorId}` : ' | root';
          lines.push(`  - ${a.agentId} | ${a.role} | ${a.status} | ${ipc}${sup}`);
        }
        lines.push('Use send_message tool with target agentId to communicate.');
      }

      lines.push('[/LIVE SYSTEM STATE]');
      return lines.join('\n');
    } catch (err) {
      this.logger.warn(
        `getLiveContext failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return '';
    }
  }
}
