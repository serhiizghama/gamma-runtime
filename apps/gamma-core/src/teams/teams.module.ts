import { Module, forwardRef } from '@nestjs/common';
import { StateModule } from '../state/state.module';
import { AgentsModule } from '../agents/agents.module';
import { ActivityModule } from '../activity/activity.module';
import { MessagingModule } from '../messaging/messaging.module';
import { SessionsModule } from '../sessions/sessions.module';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';
import { TeamBlueprintService } from './team-blueprint.service';
import { TaskClaimService } from './task-claim.service';

@Module({
  imports: [
    StateModule,
    AgentsModule,
    ActivityModule,
    MessagingModule,
    forwardRef(() => SessionsModule),
  ],
  controllers: [TeamsController],
  providers: [TeamsService, TeamBlueprintService, TaskClaimService],
  exports: [TeamsService, TeamBlueprintService, TaskClaimService],
})
export class TeamsModule {}
