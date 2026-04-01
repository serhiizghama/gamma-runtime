import { Controller, Get, Query } from '@nestjs/common';
import { TraceService } from './trace.service';

@Controller('trace')
export class TraceController {
  constructor(private readonly traceService: TraceService) {}

  @Get()
  query(
    @Query('teamId') teamId?: string,
    @Query('agentId') agentId?: string,
    @Query('taskId') taskId?: string,
    @Query('kind') kind?: string,
    @Query('limit') limit?: string,
    @Query('since') since?: string,
  ) {
    return this.traceService.query({
      teamId,
      agentId,
      taskId,
      kind,
      limit: limit ? parseInt(limit, 10) : undefined,
      since: since ? parseInt(since, 10) : undefined,
    });
  }
}
