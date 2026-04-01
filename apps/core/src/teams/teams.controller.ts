import { Controller, Get, Post, Patch, Delete, Param, Body } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { AgentsService } from '../agents/agents.service';

@Controller('teams')
export class TeamsController {
  constructor(
    private readonly teamsService: TeamsService,
    private readonly agentsService: AgentsService,
  ) {}

  @Get()
  findAll() {
    return this.teamsService.findAll();
  }

  @Post()
  async create(@Body() dto: CreateTeamDto) {
    const team = await this.teamsService.create(dto);

    // If leaderRoleId provided, create leader agent atomically
    if (dto.leaderRoleId) {
      const leader = await this.agentsService.create({
        name: dto.leaderName ?? 'Team Lead',
        roleId: dto.leaderRoleId,
        teamId: team.id,
        specialization: dto.leaderSpec,
        isLeader: true,
      });
      team.members = [leader];
    }

    return team;
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.teamsService.findById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTeamDto) {
    return this.teamsService.update(id, dto);
  }

  @Delete(':id')
  archive(@Param('id') id: string) {
    return this.teamsService.archive(id);
  }
}
