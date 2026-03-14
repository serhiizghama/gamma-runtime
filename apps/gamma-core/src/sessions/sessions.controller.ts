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
  UseGuards,
} from '@nestjs/common';
import { SessionsService } from './sessions.service';
import type { SendMessageResult } from './sessions.service';
import { SessionRegistryService } from './session-registry.service';
import { SystemAppGuard } from './system-guard';
import type {
  WindowSession,
  CreateSessionDto,
  WindowStateSyncSnapshot,
  SessionRecord,
} from '@gamma/types';

@Controller('api/sessions')
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly registry: SessionRegistryService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateSessionDto,
  ): Promise<{ ok: true; session: WindowSession }> {
    const session = await this.sessions.create(dto);
    return { ok: true, session };
  }

  // ── Agent Control Plane endpoints (Stage 4) ───────────────────────────
  // ALL literal and sessionKey-based routes MUST come before any `:windowId`
  // parameterized routes so NestJS/Express never shadows them. Do not reorder.

  /** Returns the full session registry — all active agent telemetry records. */
  @Get('active')
  @UseGuards(SystemAppGuard)
  async getActiveRegistry(): Promise<SessionRecord[]> {
    return this.registry.getAll();
  }

  /** Returns the full system prompt stored for the given session key. */
  @Get(':sessionKey/context')
  @UseGuards(SystemAppGuard)
  async getContext(
    @Param('sessionKey') sessionKey: string,
  ): Promise<{ context: string }> {
    const context = await this.registry.getContext(sessionKey);
    if (context === null) {
      throw new NotFoundException(`No context found for session ${sessionKey}`);
    }
    return { context };
  }

  /**
   * Kill all active sessions (Gateway-side deletion + full Redis cleanup),
   * then flush any remaining orphaned registry/context keys.
   * This is a hard reset — all sessions will be gone from OpenClaw Gateway.
   */
  @Delete('registry/flush')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SystemAppGuard)
  async flushRegistry(): Promise<{ ok: boolean; deleted: number }> {
    const killed = await this.sessions.killAll();
    // Flush any orphaned registry/context keys not covered by killAll
    await this.registry.flushAll();
    return { ok: true, deleted: killed };
  }

  /** Force-kill a session by its sessionKey — aborts the run and marks registry as aborted. */
  @Post(':sessionKey/kill')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SystemAppGuard)
  async kill(
    @Param('sessionKey') sessionKey: string,
  ): Promise<{ ok: boolean }> {
    const killed = await this.sessions.killBySessionKey(sessionKey);
    if (!killed) {
      throw new NotFoundException(`No session found for sessionKey ${sessionKey}`);
    }
    return { ok: true };
  }

  // ── Standard session endpoints ────────────────────────────────────────

  @Get()
  async findAll(): Promise<WindowSession[]> {
    return this.sessions.findAll();
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

  @Post(':windowId/send')
  @HttpCode(HttpStatus.OK)
  async send(
    @Param('windowId') windowId: string,
    @Body() body: { message: string },
  ): Promise<SendMessageResult> {
    const result = await this.sessions.sendMessage(windowId, body.message);
    if (!result) {
      throw new NotFoundException(`No session for window ${windowId}`);
    }
    return result;
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
