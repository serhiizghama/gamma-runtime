/**
 * agents.controller.ts — Agent Genesis API
 *
 * Endpoints:
 *   GET    /api/agents/roles   — List available community role templates
 *   GET    /api/agents         — List all agents (active + archived)
 *   POST   /api/agents         — Create a new generative agent
 *   DELETE /api/agents/:id     — Soft-delete (archive) an agent
 */

import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { SystemAppGuard } from '../sessions/system-guard';
import { CreateAgentBody } from '../dto/create-agent.dto';
import { AgentFactoryService } from './agent-factory.service';

@Controller('api/agents')
@UseGuards(SystemAppGuard)
export class AgentsController {
  constructor(private readonly factory: AgentFactoryService) {}

  /** List all available community role templates from the manifest. */
  @Get('roles')
  getRoles() {
    return this.factory.getRoles();
  }

  /** List all agents (any status). */
  @Get()
  listAgents() {
    return this.factory.findAllAgents();
  }

  /** Create a new agent via generative LLM pipeline. */
  @Post()
  async createAgent(@Body() body: CreateAgentBody) {
    return this.factory.createAgent({
      roleId: body.roleId,
      name: body.name,
      customDirectives: body.customDirectives,
    });
  }

  /** Soft-delete an agent (archive). Preserves knowledge chunks. */
  @Delete(':id')
  @HttpCode(200)
  async deleteAgent(@Param('id') id: string) {
    return this.factory.deleteAgent(id);
  }
}
