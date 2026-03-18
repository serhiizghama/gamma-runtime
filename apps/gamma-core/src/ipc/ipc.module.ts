import { Module, forwardRef } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { ActivityModule } from '../activity/activity.module';
import { SessionsModule } from '../sessions/sessions.module';
import { StateModule } from '../state/state.module';
import { IpcRoutingService } from './ipc-routing.service';
import { IpcController } from './ipc.controller';
import { DelegateTaskTool } from './delegate-task.tool';
import { ReportStatusTool } from './report-status.tool';

@Module({
  imports: [
    MessagingModule,
    ActivityModule,
    StateModule,
    forwardRef(() => SessionsModule),
  ],
  controllers: [IpcController],
  providers: [IpcRoutingService, DelegateTaskTool, ReportStatusTool],
  exports: [IpcRoutingService, DelegateTaskTool, ReportStatusTool],
})
export class IpcModule {}
