import { Module } from '@nestjs/common';
import { ToolRegistryService } from './tool-registry.service';
import { ToolExecutorService } from './tool-executor.service';
import { TOOL_EXECUTORS } from './constants';
import { SpawnSubAgentTool } from './internal/spawn-sub-agent.tool';
import { SendMessageTool } from './internal/send-message.tool';
import { MessagingModule } from '../messaging/messaging.module';
import { ActivityModule } from '../activity/activity.module';
import { IpcModule } from '../ipc/ipc.module';
import { DelegateTaskTool } from '../ipc/delegate-task.tool';
import { ReportStatusTool } from '../ipc/report-status.tool';

// SessionsModule removed from imports to break circular:
// GatewayModule → ToolsModule → SessionsModule → GatewayModule.
// SpawnSubAgentTool uses @Optional() SessionsService resolved via ModuleRef at runtime.
@Module({
  imports: [
    MessagingModule,
    ActivityModule,
    IpcModule,
  ],
  providers: [
    ToolExecutorService,
    ToolRegistryService,
    SpawnSubAgentTool,
    SendMessageTool,
    ReportStatusTool,
    {
      provide: TOOL_EXECUTORS,
      useFactory: (
        spawnSubAgent: SpawnSubAgentTool,
        sendMessage: SendMessageTool,
        delegateTask: DelegateTaskTool,
        reportStatus: ReportStatusTool,
      ) => [spawnSubAgent, sendMessage, delegateTask, reportStatus],
      inject: [SpawnSubAgentTool, SendMessageTool, DelegateTaskTool, ReportStatusTool],
    },
  ],
  exports: [ToolRegistryService, ToolExecutorService],
})
export class ToolsModule {}
