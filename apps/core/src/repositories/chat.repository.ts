import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ChatMessage, ChatRole } from '../common/types';
import { chatMessageId } from '../common/ulid';

@Injectable()
export class ChatRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(data: {
    team_id: string;
    role: ChatRole;
    content: string;
    agent_id?: string;
  }): Promise<ChatMessage> {
    const now = Date.now();
    const id = chatMessageId();
    const { rows } = await this.db.query<ChatMessage>(
      `INSERT INTO chat_messages (id, team_id, role, agent_id, content, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, data.team_id, data.role, data.agent_id ?? null, data.content, now],
    );
    return rows[0];
  }

  async findByTeam(
    teamId: string,
    opts: { limit?: number; before?: number } = {},
  ): Promise<ChatMessage[]> {
    const limit = opts.limit ?? 50;
    if (opts.before) {
      const { rows } = await this.db.query<ChatMessage>(
        'SELECT * FROM chat_messages WHERE team_id = $1 AND created_at < $2 ORDER BY created_at DESC LIMIT $3',
        [teamId, opts.before, limit],
      );
      return rows.reverse();
    }
    const { rows } = await this.db.query<ChatMessage>(
      'SELECT * FROM chat_messages WHERE team_id = $1 ORDER BY created_at DESC LIMIT $2',
      [teamId, limit],
    );
    return rows.reverse();
  }

  async deleteByTeam(teamId: string): Promise<void> {
    await this.db.query('DELETE FROM chat_messages WHERE team_id = $1', [teamId]);
  }
}
