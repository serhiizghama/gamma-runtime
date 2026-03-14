import { Module } from '@nestjs/common';
import { PtyService } from './pty.service';
import { PtyController } from './pty.controller';

@Module({
  providers:   [PtyService],
  controllers: [PtyController],
  exports:     [PtyService],
})
export class PtyModule {}
