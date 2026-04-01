import { Module } from '@nestjs/common';
import { ClaudeCliAdapter } from './claude-cli.adapter';
import { SessionPoolService } from './session-pool.service';

@Module({
  providers: [ClaudeCliAdapter, SessionPoolService],
  exports: [ClaudeCliAdapter, SessionPoolService],
})
export class ClaudeModule {}
