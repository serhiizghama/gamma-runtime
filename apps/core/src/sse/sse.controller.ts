import { Controller, Get, Param, Res } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { SseService } from './sse.service';

@Controller()
export class SseController {
  constructor(private readonly sseService: SseService) {}

  @Get('stream')
  globalStream(@Res() reply: FastifyReply) {
    this.sseService.streamGlobal(reply);
  }

  @Get('teams/:id/stream')
  teamStream(@Param('id') id: string, @Res() reply: FastifyReply) {
    this.sseService.streamTeam(id, reply);
  }

  @Get('agents/:id/stream')
  agentStream(@Param('id') id: string, @Res() reply: FastifyReply) {
    this.sseService.streamAgent(id, reply);
  }
}
