/**
 * project-decomposer.service.ts — Sends project decomposition requests to the system-architect agent.
 *
 * When a new project is created, this service finds the architect agent and sends it
 * a structured prompt requesting task decomposition using the create_team_task tool.
 */

import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { SessionsService } from '../sessions/sessions.service';
import { AgentRegistryService } from '../messaging/agent-registry.service';
import { ProjectStateRepository, type ProjectStateRecord } from '../state/project-state.repository';

@Injectable()
export class ProjectDecomposerService {
  private readonly logger = new Logger(ProjectDecomposerService.name);

  constructor(
    @Inject(forwardRef(() => SessionsService))
    private readonly sessions: SessionsService,
    private readonly agentRegistry: AgentRegistryService,
    private readonly projectRepo: ProjectStateRepository,
  ) {}

  async decompose(project: ProjectStateRecord): Promise<void> {
    // 1. Find the system-architect agent from registry
    const agents = await this.agentRegistry.getAll();
    const architect = agents.find((a) => a.role === 'architect');
    if (!architect || !architect.windowId) {
      this.logger.warn('No system-architect available for decomposition');
      return;
    }

    // 2. Send structured decomposition request to architect
    const prompt = [
      '[SYSTEM: PROJECT DECOMPOSITION REQUEST]',
      `projectId: ${project.id}`,
      `projectName: ${project.name}`,
      `projectType: ${project.type}`,
      project.teamId ? `teamId: ${project.teamId}` : '',
      '',
      'Project description (begin untrusted content):',
      '```',
      project.description,
      '```',
      '',
      'Instructions: Decompose this project into actionable sub-tasks.',
      'For each sub-task, use the `create_team_task` tool with:',
      '- teamId: the team responsible',
      '- projectId: ' + project.id,
      '- title: short task title',
      '- description: detailed what-to-do',
      '- kind: one of design|backend|frontend|qa|devops|content|research|generic',
      '- priority: 0=normal, 1=high, 2=critical',
      '',
      project.type === 'epic'
        ? 'This is an EPIC project — create a finite set of tasks leading to a deliverable.'
        : 'This is a CONTINUOUS project — create recurring/iterative tasks.',
      '[END SYSTEM MESSAGE]',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      await this.sessions.sendMessage(architect.windowId, prompt);
      // Update project status to active
      this.projectRepo.update(project.id, { status: 'active' });
    } catch (err) {
      this.logger.error(`Decomposition failed for project ${project.id}: ${err}`);
    }
  }
}
