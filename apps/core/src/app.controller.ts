import { Controller, Get, Post } from '@nestjs/common';
import { EventBusService } from './events/event-bus.service';
import { SessionPoolService } from './claude/session-pool.service';
import { DatabaseService } from './database/database.service';

@Controller()
export class AppController {
  constructor(
    private readonly eventBus: EventBusService,
    private readonly sessionPool: SessionPoolService,
    private readonly db: DatabaseService,
  ) {}

  @Get('health')
  health() {
    const pool = this.sessionPool.stats;
    return { status: 'ok', pool };
  }

  @Post('emergency-stop')
  async emergencyStop() {
    const killedAgentIds = await this.sessionPool.abortAll();

    if (killedAgentIds.length > 0) {
      // Reset all killed agents to idle in DB
      const placeholders = killedAgentIds.map((_, i) => `$${i + 2}`).join(', ');
      await this.db.query(
        `UPDATE agents SET status = 'idle', updated_at = $1 WHERE id IN (${placeholders})`,
        [Date.now(), ...killedAgentIds],
      );

      // Fail any in-progress tasks assigned to killed agents
      await this.db.query(
        `UPDATE tasks SET stage = 'failed', updated_at = $1 WHERE assigned_to IN (${placeholders}) AND stage = 'in_progress'`,
        [Date.now(), ...killedAgentIds],
      );
    }

    this.eventBus.emit({
      kind: 'system.emergency_stop',
      content: { message: 'All agents stopped', agentIds: killedAgentIds },
    });
    return { status: 'stopped', killed: killedAgentIds.length };
  }
}
