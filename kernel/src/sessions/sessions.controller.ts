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
