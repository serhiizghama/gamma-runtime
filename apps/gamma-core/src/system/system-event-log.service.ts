import { Injectable } from '@nestjs/common';

export type SystemEventType = 'info' | 'warn' | 'error' | 'critical';

export interface SystemEvent {
  ts: number;
  type: SystemEventType;
  message: string;
}

const MAX_EVENTS = 100;

/**
 * In-memory ring buffer for system-level audit events.
 *
 * Lightweight, zero-dependency service that any module can inject
 * to record operational events (snapshot creation, watchdog timeouts, etc.).
 * Newest events are appended; oldest are evicted past MAX_EVENTS.
 */
@Injectable()
export class SystemEventLog {
  private readonly buffer: SystemEvent[] = [];

  push(message: string, type: SystemEventType = 'info'): void {
    this.buffer.push({ ts: Date.now(), type, message });
    if (this.buffer.length > MAX_EVENTS) {
      this.buffer.splice(0, this.buffer.length - MAX_EVENTS);
    }
  }

  /** Returns events newest-first (shallow copy). */
  getAll(): SystemEvent[] {
    return this.buffer.slice().reverse();
  }
}
