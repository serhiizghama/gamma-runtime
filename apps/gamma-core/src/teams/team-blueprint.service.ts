/**
 * team-blueprint.service.ts — Blueprint-based team spawning.
 *
 * Loads blueprint definitions from /data/blueprints/*.json on initialization.
 * Provides blueprint listing and team spawning with automatic agent creation.
 */

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { resolve } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { TeamsService } from './teams.service';
import { AgentFactoryService, type AgentInstanceDto } from '../agents/agent-factory.service';
import { ActivityStreamService } from '../activity/activity-stream.service';
import type { TeamStateRecord } from '../state/team-state.repository';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BlueprintMember {
  roleId: string;
  name: string;
  count: number;
}

export interface TeamBlueprint {
  id: string;
  name: string;
  description: string;
  members: BlueprintMember[];
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class TeamBlueprintService {
  private readonly logger = new Logger(TeamBlueprintService.name);
  private blueprints: TeamBlueprint[] = [];
  private readonly blueprintsDir: string;

  constructor(
    private readonly teamsService: TeamsService,
    private readonly agentFactory: AgentFactoryService,
    private readonly activity: ActivityStreamService,
  ) {
    const repoRoot = resolve(__dirname, '..', '..', '..', '..');
    this.blueprintsDir = resolve(repoRoot, 'data', 'blueprints');
    this.loadBlueprints();
  }

  // ── Blueprint Loading ──────────────────────────────────────────────

  /** Load all blueprint JSON files from disk. */
  private loadBlueprints(): void {
    if (!existsSync(this.blueprintsDir)) {
      this.logger.warn(`Blueprints directory not found: ${this.blueprintsDir}`);
      this.blueprints = [];
      return;
    }

    try {
      const files = readdirSync(this.blueprintsDir).filter((f) => f.endsWith('.json'));
      this.blueprints = files.map((file) => {
        const raw = readFileSync(resolve(this.blueprintsDir, file), 'utf-8');
        return JSON.parse(raw) as TeamBlueprint;
      });
      this.logger.log(`Loaded ${this.blueprints.length} blueprint(s) from ${this.blueprintsDir}`);
    } catch (err) {
      this.logger.error(`Failed to load blueprints: ${err}`);
      this.blueprints = [];
    }
  }

  // ── Public API ─────────────────────────────────────────────────────

  /** List all available blueprints. */
  getBlueprints(): TeamBlueprint[] {
    return this.blueprints;
  }

  /** Find a single blueprint by ID. */
  getBlueprint(id: string): TeamBlueprint | undefined {
    return this.blueprints.find((b) => b.id === id);
  }

  /**
   * Spawn a full team from a blueprint definition.
   *
   * 1. Load and validate blueprint
   * 2. Create team record via TeamsService
   * 3. Spawn agents for each member role
   * 4. Update each agent's teamId
   * 5. Emit team_spawned activity event
   */
  async spawnFromBlueprint(
    blueprintId: string,
  ): Promise<{ team: TeamStateRecord; agents: AgentInstanceDto[] }> {
    const blueprint = this.getBlueprint(blueprintId);
    if (!blueprint) {
      throw new NotFoundException(`Blueprint not found: "${blueprintId}"`);
    }

    this.logger.log(`Spawning team from blueprint: "${blueprint.name}" (${blueprintId})`);

    // 1. Create team record
    const team = this.teamsService.createTeam(
      blueprint.name,
      blueprint.description,
      blueprint.id,
    );

    // 2. Spawn agents for each member definition
    const agents: AgentInstanceDto[] = [];

    for (const member of blueprint.members) {
      for (let i = 0; i < member.count; i++) {
        try {
          const agent = await this.agentFactory.createAgent({
            roleId: member.roleId,
            name: member.name,
            teamId: team.id,
          });
          agents.push(agent);
          this.logger.log(`Spawned agent "${member.name}" (${agent.agentId}) for team ${team.id}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(`Failed to spawn agent for role "${member.roleId}": ${msg}`);
          // Continue spawning remaining agents even if one fails
        }
      }
    }

    // 3. Emit activity event
    this.activity.emit({
      kind: 'team_spawned',
      agentId: 'system',
      payload: `Team "${blueprint.name}" spawned from blueprint with ${agents.length} agent(s)`,
      severity: 'info',
    });

    this.logger.log(
      `Team "${blueprint.name}" (${team.id}) spawned with ${agents.length}/${blueprint.members.length} agent(s)`,
    );

    return { team, agents };
  }
}
