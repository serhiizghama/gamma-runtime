import { Controller, Get, Post, Patch, Delete, Param, Body, Query } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { AgentsService } from '../agents/agents.service';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { ChatService } from '../chat/chat.service';

@Controller('teams')
export class TeamsController {
  constructor(
    private readonly teamsService: TeamsService,
    private readonly agentsService: AgentsService,
    private readonly orchestrator: OrchestratorService,
    private readonly chat: ChatService,
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

  @Post(':id/message')
  async sendMessage(
    @Param('id') id: string,
    @Body() body: { message: string },
  ) {
    await this.orchestrator.handleTeamMessage(id, body.message);
    return { success: true };
  }

  @Get(':id/chat')
  getChat(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    return this.chat.getHistory(id, {
      limit: limit ? parseInt(limit, 10) : undefined,
      before: before ? parseInt(before, 10) : undefined,
    });
  }
}
