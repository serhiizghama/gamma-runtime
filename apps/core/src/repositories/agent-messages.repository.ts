import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AgentMessage } from '../common/types';
import { agentMessageId } from '../common/ulid';

@Injectable()
export class AgentMessagesRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(data: {
    team_id: string;
    from_agent?: string;
    to_agent: string;
    content: string;
  }): Promise<AgentMessage> {
    const now = Date.now();
    const id = agentMessageId();
    const { rows } = await this.db.query<AgentMessage>(
      `INSERT INTO agent_messages (id, team_id, from_agent, to_agent, content, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, data.team_id, data.from_agent ?? null, data.to_agent, data.content, now],
    );
    return this.mapMessage(rows[0]);
  }

  async findUnread(agentId: string): Promise<AgentMessage[]> {
    const { rows } = await this.db.query<AgentMessage>(
      'SELECT * FROM agent_messages WHERE to_agent = $1 AND read = 0 ORDER BY created_at ASC',
      [agentId],
    );
    return rows.map(this.mapMessage);
  }

  async markRead(id: string): Promise<void> {
    await this.db.query('UPDATE agent_messages SET read = 1 WHERE id = $1', [id]);
  }

  async markAllRead(agentId: string): Promise<void> {
    await this.db.query(
      'UPDATE agent_messages SET read = 1 WHERE to_agent = $1 AND read = 0',
      [agentId],
    );
  }

  async findByTeam(teamId: string, limit = 100): Promise<AgentMessage[]> {
    const { rows } = await this.db.query<AgentMessage>(
      'SELECT * FROM agent_messages WHERE team_id = $1 ORDER BY created_at DESC LIMIT $2',
      [teamId, limit],
    );
    return rows.map(this.mapMessage);
  }

  private mapMessage(row: AgentMessage): AgentMessage {
    return {
      ...row,
      read: Boolean(row.read),
    };
  }
}
