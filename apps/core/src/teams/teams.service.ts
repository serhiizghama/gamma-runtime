import { Injectable, NotFoundException } from '@nestjs/common';
import { TeamsRepository } from '../repositories/teams.repository';
import { AgentsRepository } from '../repositories/agents.repository';
import { Team, Agent } from '../common/types';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';

export interface TeamWithMembers extends Team {
  members: Agent[];
}

@Injectable()
export class TeamsService {
  constructor(
    private readonly teamsRepo: TeamsRepository,
    private readonly agentsRepo: AgentsRepository,
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
    await this.agentsRepo.archiveByTeam(id);
    const team = await this.teamsRepo.archive(id);
    if (!team) throw new NotFoundException(`Team ${id} not found`);
    return team;
  }
}
