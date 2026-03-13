import { Controller, Get } from '@nestjs/common';
import { SystemHealthService } from './system-health.service';
import type { SystemHealthReport } from '@gamma/types';

@Controller('api/system')
export class SystemController {
  constructor(private readonly health: SystemHealthService) {}

  @Get('health')
  async getHealth(): Promise<SystemHealthReport> {
    return this.health.getHealth();
  }
}
