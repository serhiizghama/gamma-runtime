import { Module } from '@nestjs/common';
import { TraceController } from './trace.controller';
import { TraceService } from './trace.service';
import { TraceRepository } from '../repositories/trace.repository';
import { EventsModule } from '../events/events.module';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule, EventsModule],
  controllers: [TraceController],
  providers: [TraceService, TraceRepository],
  exports: [TraceService],
})
export class TraceModule {}
