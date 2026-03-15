import { Controller, Get, UseGuards } from '@nestjs/common';
import { SystemHealthService } from './system-health.service';
import { SystemMonitorService } from './system-monitor.service';
import { AgentRegistryService } from '../messaging/agent-registry.service';
import { SystemAppGuard } from '../sessions/system-guard';
import type { SystemHealthReport, BackupInventory, AgentRegistryEntry } from '@gamma/types';

@Controller('api/system')
export class SystemController {
  constructor(
    private readonly health: SystemHealthService,
    private readonly monitor: SystemMonitorService,
    private readonly agentRegistry: AgentRegistryService,
  ) {}

  @Get('health')
  async getHealth(): Promise<SystemHealthReport> {
    return this.health.getHealth();
  }

  @Get('backups')
  @UseGuards(SystemAppGuard)
  async getBackups(): Promise<BackupInventory> {
    return this.monitor.getBackupInventory();
  }

  @Get('agents')
  @UseGuards(SystemAppGuard)
  async getAgents(): Promise<AgentRegistryEntry[]> {
    return this.agentRegistry.getAll();
  }
}
