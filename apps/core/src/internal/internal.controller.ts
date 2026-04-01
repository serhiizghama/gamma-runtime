import { Controller, Get, Post, Body, Query, Param } from '@nestjs/common';
import { InternalService } from './internal.service';
import { AssignTaskDto } from './dto/assign-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { MarkDoneDto } from './dto/mark-done.dto';
import { RequestReviewDto } from './dto/request-review.dto';
import { ReportStatusDto } from './dto/report-status.dto';
import { BroadcastDto } from './dto/broadcast.dto';

@Controller('internal')
export class InternalController {
  constructor(private readonly internalService: InternalService) {}

  // ── Task Management ──────────────────────────────────────────────

  @Post('assign-task')
  assignTask(@Body() dto: AssignTaskDto) {
    return this.internalService.assignTask(dto);
  }

  @Post('update-task')
  updateTask(@Body() dto: UpdateTaskDto) {
    return this.internalService.updateTask(dto);
  }

  @Get('list-tasks')
  listTasks(
    @Query('teamId') teamId?: string,
    @Query('status') status?: string,
    @Query('assignedTo') assignedTo?: string,
  ) {
    return this.internalService.listTasks({ teamId, status, assignedTo });
  }

  @Get('get-task/:id')
  getTask(@Param('id') id: string) {
    return this.internalService.getTask(id);
  }

  // ── Messaging ────────────────────────────────────────────────────

  @Post('send-message')
  sendMessage(@Body() dto: SendMessageDto) {
    return this.internalService.sendMessage(dto);
  }

  @Get('read-messages')
  readMessages(
    @Query('agentId') agentId: string,
    @Query('since') since?: string,
  ) {
    return this.internalService.readMessages(
      agentId,
      since ? parseInt(since, 10) : undefined,
    );
  }

  @Post('broadcast')
  broadcast(@Body() dto: BroadcastDto) {
    return this.internalService.broadcast(dto);
  }

  // ── Team & Project ───────────────────────────────────────────────

  @Get('list-agents')
  listAgents(@Query('teamId') teamId: string) {
    return this.internalService.listAgents(teamId);
  }

  @Post('mark-done')
  markDone(@Body() dto: MarkDoneDto) {
    return this.internalService.markDone(dto);
  }

  @Post('request-review')
  requestReview(@Body() dto: RequestReviewDto) {
    return this.internalService.requestReview(dto);
  }

  @Post('report-status')
  reportStatus(@Body() dto: ReportStatusDto) {
    return this.internalService.reportStatus(dto);
  }

  @Get('read-context')
  readContext(@Query('teamId') teamId: string) {
    return this.internalService.readContext(teamId);
  }
}
