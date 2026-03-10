import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { SessionsService } from './sessions.service';
import type { WindowSession, CreateSessionDto } from './sessions.interfaces';
import type { WindowStateSyncSnapshot } from '@gamma/types';

@Controller('api/sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateSessionDto,
  ): Promise<{ ok: true; session: WindowSession }> {
    const session = await this.sessions.create(dto);
    return { ok: true, session };
  }

  @Get()
  async findAll(): Promise<WindowSession[]> {
    return this.sessions.findAll();
  }

  @Post(':windowId/abort')
  @HttpCode(HttpStatus.OK)
  async abort(
    @Param('windowId') windowId: string,
  ): Promise<{ ok: boolean }> {
    const aborted = await this.sessions.abort(windowId);
    if (!aborted) {
      throw new NotFoundException(`No session for window ${windowId}`);
    }
    return { ok: true };
  }

  @Get(':windowId/sync')
  async sync(
    @Param('windowId') windowId: string,
  ): Promise<WindowStateSyncSnapshot> {
    const snapshot = await this.sessions.getSyncSnapshot(windowId);
    if (!snapshot) {
      throw new NotFoundException(`No session for window ${windowId}`);
    }
    return snapshot;
  }

  @Delete(':windowId')
  async remove(
    @Param('windowId') windowId: string,
  ): Promise<{ ok: boolean }> {
    const removed = await this.sessions.remove(windowId);
    if (!removed) {
      throw new NotFoundException(
        `No session for window ${windowId}`,
      );
    }
    return { ok: true };
  }
}
