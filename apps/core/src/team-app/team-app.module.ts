import { Module } from '@nestjs/common';
import { TeamAppController } from './team-app.controller';
import { TeamAppService } from './team-app.service';
import { AgentsModule } from '../agents/agents.module';

@Module({
  imports: [AgentsModule],
  controllers: [TeamAppController],
  providers: [TeamAppService],
})
export class TeamAppModule {}
