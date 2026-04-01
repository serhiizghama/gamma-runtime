import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatRepository } from '../repositories/chat.repository';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [ChatService, ChatRepository],
  exports: [ChatService],
})
export class ChatModule {}
