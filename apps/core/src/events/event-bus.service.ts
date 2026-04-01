import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from 'eventemitter2';
import { GammaEvent } from './types';
import { traceEventId } from '../common/ulid';

@Injectable()
export class EventBusService {
  constructor(private readonly emitter: EventEmitter2) {}

  emit(event: Omit<GammaEvent, 'id' | 'createdAt'> & { id?: string; createdAt?: number }): GammaEvent {
    const full: GammaEvent = {
      id: event.id ?? traceEventId(),
      createdAt: event.createdAt ?? Date.now(),
      kind: event.kind,
      teamId: event.teamId,
      agentId: event.agentId,
      taskId: event.taskId,
      content: event.content,
    };

    this.emitter.emit('gamma.event', full);
    if (full.teamId) this.emitter.emit(`gamma.team.${full.teamId}`, full);
    if (full.agentId) this.emitter.emit(`gamma.agent.${full.agentId}`, full);

    return full;
  }

  onAll(handler: (event: GammaEvent) => void): () => void {
    this.emitter.on('gamma.event', handler);
    return () => this.emitter.off('gamma.event', handler);
  }

  onTeam(teamId: string, handler: (event: GammaEvent) => void): () => void {
    const channel = `gamma.team.${teamId}`;
    this.emitter.on(channel, handler);
    return () => this.emitter.off(channel, handler);
  }

  onAgent(agentId: string, handler: (event: GammaEvent) => void): () => void {
    const channel = `gamma.agent.${agentId}`;
    this.emitter.on(channel, handler);
    return () => this.emitter.off(channel, handler);
  }
}
