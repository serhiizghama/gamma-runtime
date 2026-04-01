import { Module, forwardRef } from '@nestjs/common';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';
import { TeamsRepository } from '../repositories/teams.repository';
import { AgentsRepository } from '../repositories/agents.repository';
import { DatabaseModule } from '../database/database.module';
import { AgentsModule } from '../agents/agents.module';

@Module({
  imports: [DatabaseModule, forwardRef(() => AgentsModule)],
  controllers: [TeamsController],
  providers: [TeamsService, TeamsRepository, AgentsRepository],
  exports: [TeamsService, TeamsRepository],
})
export class TeamsModule {}
