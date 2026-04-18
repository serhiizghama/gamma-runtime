import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { TeamAppService } from './team-app.service';

@Controller('teams/:id/app')
export class TeamAppController {
  constructor(private readonly teamApp: TeamAppService) {}

  @Get('status')
  getStatus(@Param('id') teamId: string) {
    return this.teamApp.getStatus(teamId);
  }

  @Get('*')
  serveFile(
    @Param('id') teamId: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    // Extract the wildcard portion after /api/teams/:id/app/
    const url = req.url;
    const prefix = `/api/teams/${teamId}/app/`;
    let filePath = url.startsWith(prefix)
      ? url.slice(prefix.length)
      : 'index.html';

    // Strip query string
    const qIdx = filePath.indexOf('?');
    if (qIdx !== -1) filePath = filePath.slice(0, qIdx);

    // Default to index.html
    if (!filePath || filePath === 'status') {
      filePath = 'index.html';
    }

    // Serve a dynamically-composed data.json built from real artifacts on disk
    // (vacancies-nodejs.json, detailed-scoring.json, applications/, candidate-profile.yaml).
    // This overrides any stale static data.json in project/app/.
    if (filePath === 'data.json') {
      try {
        const content = this.teamApp.composeData(teamId);
        reply.header('Content-Type', 'application/json');
        reply.header('Cache-Control', 'no-cache');
        reply.send(content);
        return;
      } catch (err) {
        reply.status(500).send({ statusCode: 500, message: `Failed to compose data.json: ${err}` });
        return;
      }
    }

    try {
      const { content, mimeType } = this.teamApp.readFile(teamId, filePath);
      reply.header('Content-Type', mimeType);
      reply.header('Cache-Control', 'no-cache');
      reply.send(content);
    } catch (err: any) {
      if (err.status === 403) {
        reply.status(403).send({ statusCode: 403, message: 'Path traversal is not allowed' });
      } else if (err.status === 404) {
        reply.status(404).send({ statusCode: 404, message: err.message });
      } else {
        reply.status(500).send({ statusCode: 500, message: 'Internal server error' });
      }
    }
  }
}
