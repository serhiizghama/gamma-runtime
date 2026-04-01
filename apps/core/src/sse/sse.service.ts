import { Injectable, Logger } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { EventBusService } from '../events/event-bus.service';
import { GammaEvent } from '../events/types';

const HEARTBEAT_INTERVAL_MS = 30_000;

@Injectable()
export class SseService {
  private readonly logger = new Logger(SseService.name);

  constructor(private readonly eventBus: EventBusService) {}

  streamGlobal(reply: FastifyReply): void {
    this.setupStream(reply, (handler) => this.eventBus.onAll(handler));
  }

  streamTeam(teamId: string, reply: FastifyReply): void {
    this.setupStream(reply, (handler) => this.eventBus.onTeam(teamId, handler));
  }

  streamAgent(agentId: string, reply: FastifyReply): void {
    this.setupStream(reply, (handler) => this.eventBus.onAgent(agentId, handler));
  }

  private setupStream(
    reply: FastifyReply,
    subscribe: (handler: (event: GammaEvent) => void) => () => void,
  ): void {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send initial connection event
    reply.raw.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

    // Subscribe to events
    const handler = (event: GammaEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const unsubscribe = subscribe(handler);

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      reply.raw.write(': heartbeat\n\n');
    }, HEARTBEAT_INTERVAL_MS);

    // Cleanup on disconnect
    reply.raw.on('close', () => {
      unsubscribe();
      clearInterval(heartbeat);
      this.logger.debug('SSE client disconnected');
    });
  }
}
