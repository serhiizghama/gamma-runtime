import { Controller, Post, Get } from '@nestjs/common';
import { PtyService } from './pty.service';

@Controller('api/pty')
export class PtyController {
  constructor(private readonly ptyService: PtyService) {}

  /**
   * Issue a single-use PTY auth token (60s TTL).
   * Frontend calls this before opening the WebSocket.
   */
  @Post('token')
  issueToken(): { token: string } {
    return { token: this.ptyService.generateToken() };
  }

  /** Health/debug: number of active PTY sessions */
  @Get('sessions')
  activeSessions(): { count: number } {
    return { count: this.ptyService.getActiveSessionCount() };
  }
}
