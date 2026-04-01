import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { TeamsRepository } from '../repositories/teams.repository';
import { AgentsRepository } from '../repositories/agents.repository';
import { ProjectsRepository } from '../repositories/projects.repository';
import { TasksRepository } from '../repositories/tasks.repository';
import { SessionPoolService } from '../claude/session-pool.service';
import { Team, Agent } from '../common/types';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';

export interface TeamWithMembers extends Team {
  members: Agent[];
}

@Injectable()
export class TeamsService {
  private readonly logger = new Logger(TeamsService.name);

  constructor(
    private readonly teamsRepo: TeamsRepository,
    private readonly agentsRepo: AgentsRepository,
    private readonly projectsRepo: ProjectsRepository,
    private readonly tasksRepo: TasksRepository,
    private readonly sessionPool: SessionPoolService,
  ) {}

  async create(dto: CreateTeamDto): Promise<TeamWithMembers> {
    const team = await this.teamsRepo.create({
      name: dto.name,
      description: dto.description,
    });
    const members: Agent[] = [];
    return { ...team, members };
  }

  async findAll(): Promise<TeamWithMembers[]> {
    const teams = await this.teamsRepo.findAll();
    const results: TeamWithMembers[] = [];
    for (const team of teams) {
      const members = await this.agentsRepo.findByTeam(team.id);
      results.push({ ...team, members });
    }
    return results;
  }

  async findById(id: string): Promise<TeamWithMembers> {
    const team = await this.teamsRepo.findById(id);
    if (!team) throw new NotFoundException(`Team ${id} not found`);
    const members = await this.agentsRepo.findByTeam(id);
    return { ...team, members };
  }

  async update(id: string, dto: UpdateTeamDto): Promise<TeamWithMembers> {
    const team = await this.teamsRepo.update(id, dto);
    if (!team) throw new NotFoundException(`Team ${id} not found`);
    const members = await this.agentsRepo.findByTeam(id);
    return { ...team, members };
  }

  async archive(id: string): Promise<Team> {
    // Kill all running agent processes for this team
    const agents = await this.agentsRepo.findByTeam(id);
    for (const agent of agents) {
      if (this.sessionPool.isRunning(agent.id)) {
        const proc = this.sessionPool.getProcess(agent.id);
        if (proc?.pid) {
          this.logger.warn(`Killing running agent ${agent.id} during team archive`);
          try { process.kill(-proc.pid, 'SIGTERM'); } catch {}
        }
        this.sessionPool.unregister(agent.id);
      }
    }

    // Fail all active projects and tasks
    await this.projectsRepo.failByTeam(id);
    await this.tasksRepo.failByTeam(id);

    // Archive all agents
    await this.agentsRepo.archiveByTeam(id);

    const team = await this.teamsRepo.archive(id);
    if (!team) throw new NotFoundException(`Team ${id} not found`);
    return team;
  }
}
