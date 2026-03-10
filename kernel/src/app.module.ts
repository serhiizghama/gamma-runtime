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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    RedisModule,
    GatewayModule,
    SessionsModule,
    SseModule,
    SystemModule,
    ScaffoldModule,
    AppDataModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
