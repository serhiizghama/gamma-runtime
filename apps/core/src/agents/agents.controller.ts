import { Controller, Get, Post, Patch, Delete, Param, Body } from '@nestjs/common';
import { AgentsService } from './agents.service';
import { RolesService } from './roles.service';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';

@Controller('agents')
export class AgentsController {
  constructor(
    private readonly agentsService: AgentsService,
    private readonly rolesService: RolesService,
  ) {}

  @Get('roles')
  getRoles() {
    return this.rolesService.getGrouped();
  }

  @Get()
  findAll() {
    return this.agentsService.findAll();
  }

  @Post()
  create(@Body() dto: CreateAgentDto) {
    return this.agentsService.create(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.agentsService.findById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAgentDto) {
    return this.agentsService.update(id, dto);
  }

  @Delete(':id')
  archive(@Param('id') id: string) {
    return this.agentsService.archive(id);
  }

  @Post(':id/reset-session')
  resetSession(@Param('id') id: string) {
    return this.agentsService.resetSession(id);
  }

  @Post('regenerate-team/:teamId')
  async regenerateTeam(@Param('teamId') teamId: string) {
    await this.agentsService.regenerateTeamClaudeMd(teamId);
    return { ok: true, teamId };
  }
}
