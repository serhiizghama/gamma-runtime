import { Module } from '@nestjs/common';
import { ToolRegistryService } from './tool-registry.service';
import { ToolExecutorService } from './tool-executor.service';
import { TOOL_EXECUTORS } from './constants';
import { SpawnSubAgentTool } from './internal/spawn-sub-agent.tool';
import { SendMessageTool } from './internal/send-message.tool';
import { MessagingModule } from '../messaging/messaging.module';
import { ActivityModule } from '../activity/activity.module';

// SessionsModule removed from imports to break circular:
// GatewayModule → ToolsModule → SessionsModule → GatewayModule.
// SpawnSubAgentTool uses @Optional() SessionsService resolved via ModuleRef at runtime.
@Module({
  imports: [
    MessagingModule,
    ActivityModule,
  ],
  providers: [
    ToolExecutorService,
    ToolRegistryService,
    SpawnSubAgentTool,
    SendMessageTool,
    {
      provide: TOOL_EXECUTORS,
      useFactory: (
        spawnSubAgent: SpawnSubAgentTool,
        sendMessage: SendMessageTool,
      ) => [spawnSubAgent, sendMessage],
      inject: [SpawnSubAgentTool, SendMessageTool],
    },
  ],
  exports: [ToolRegistryService, ToolExecutorService],
})
export class ToolsModule {}
