import { Controller, Get, Post, Body } from '@nestjs/common';
import { EventBusService } from './events/event-bus.service';
import { SessionPoolService } from './claude/session-pool.service';

@Controller()
export class AppController {
  constructor(
    private readonly eventBus: EventBusService,
    private readonly sessionPool: SessionPoolService,
  ) {}

  @Get('health')
  health() {
    const pool = this.sessionPool.stats;
    return { status: 'ok', pool };
  }

  @Post('emergency-stop')
  async emergencyStop() {
    await this.sessionPool.abortAll();
    this.eventBus.emit({ kind: 'system.emergency_stop', content: { message: 'All agents stopped' } });
    return { status: 'stopped' };
  }
}
