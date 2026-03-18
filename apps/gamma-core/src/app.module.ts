import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { RedisModule } from './redis/redis.module';
import { GatewayModule } from './gateway/gateway.module';
import { SessionsModule } from './sessions/sessions.module';
import { SseModule } from './sse/sse.module';
import { SystemModule } from './system/system.module';
import { ScaffoldModule } from './scaffold/scaffold.module';
import { AppDataModule } from './app-data/app-data.module';
import { PtyModule } from './pty/pty.module';
import { SystemEventLogModule } from './system/system-event-log.module';
import { ContextInjectorModule } from './scaffold/context-injector.module';
import { ToolsModule } from './tools/tools.module';
import { StateModule } from './state/state.module';
import { AgentsModule } from './agents/agents.module';
import { IpcModule } from './ipc/ipc.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    SystemEventLogModule,
    RedisModule,
    GatewayModule,
    ContextInjectorModule,
    SessionsModule,
    SseModule,
    SystemModule,
    ScaffoldModule,
    AppDataModule,
    PtyModule,
    ToolsModule,
    StateModule,
    AgentsModule,
    IpcModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
