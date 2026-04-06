import { Injectable, Logger } from '@nestjs/common';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);
  private readonly root: string;

  constructor() {
    const projectRoot = join(__dirname, '..', '..', '..', '..');
    this.root = process.env.WORKSPACE_ROOT ?? join(projectRoot, 'data', 'workspaces');
  }

  getTeamPath(teamId: string): string {
    return join(this.root, teamId);
  }

  getAgentPath(teamId: string, agentId: string): string {
    return join(this.root, teamId, 'agents', agentId);
  }

  createTeamWorkspace(teamId: string): string {
    const teamPath = this.getTeamPath(teamId);
    const dirs = [
      join(teamPath, 'project'),
      join(teamPath, 'plans'),
      join(teamPath, 'shared'),
    ];
    for (const dir of dirs) {
      mkdirSync(dir, { recursive: true });
    }
    this.logger.log(`Created team workspace: ${teamPath}`);
    return teamPath;
  }

  createAgentWorkspace(teamId: string, agentId: string): string {
    const agentPath = this.getAgentPath(teamId, agentId);
    mkdirSync(join(agentPath, 'notes'), { recursive: true });
    this.logger.log(`Created agent workspace: ${agentPath}`);
    return agentPath;
  }

  writeClaudeMd(teamId: string, agentId: string, content: string): void {
    const agentPath = this.getAgentPath(teamId, agentId);
    if (!existsSync(agentPath)) {
      mkdirSync(agentPath, { recursive: true });
    }
    writeFileSync(join(agentPath, 'CLAUDE.md'), content, 'utf-8');
  }
}
