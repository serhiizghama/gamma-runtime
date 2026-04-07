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

    // Reset ALL running agents to idle (not just pool-registered ones,
    // since a process might not have been registered due to timing)
    const now = Date.now();
    await this.db.query(
      `UPDATE agents SET status = 'idle', updated_at = $1 WHERE status = 'running'`,
      [now],
    );

    // Fail ALL in-progress tasks (not just those assigned to pool-registered agents)
    await this.db.query(
      `UPDATE tasks SET stage = 'failed', updated_at = $1 WHERE stage = 'in_progress'`,
      [now],
    );

    this.eventBus.emit({
      kind: 'system.emergency_stop',
      content: { message: 'All agents stopped', agentIds: killedAgentIds },
    });
    return { status: 'stopped', killed: killedAgentIds.length };
  }
}
