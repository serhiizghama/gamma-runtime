import { Injectable } from '@nestjs/common';
import { ChatRepository } from '../repositories/chat.repository';
import { ChatMessage, ChatRole } from '../common/types';

@Injectable()
export class ChatService {
  constructor(private readonly chatRepo: ChatRepository) {}

  async save(data: {
    teamId: string;
    role: ChatRole;
    content: string;
    agentId?: string;
  }): Promise<ChatMessage> {
    return this.chatRepo.insert({
      team_id: data.teamId,
      role: data.role,
      content: data.content,
      agent_id: data.agentId,
    });
  }

  async getHistory(
    teamId: string,
    opts?: { limit?: number; before?: number },
  ): Promise<ChatMessage[]> {
    return this.chatRepo.findByTeam(teamId, opts);
  }

  async clear(teamId: string): Promise<void> {
    return this.chatRepo.deleteByTeam(teamId);
  }
}
