/**
 * UnifiedSseManager — singleton that maintains ONE EventSource connection
 * to /api/stream/unified, multiplexing all SSE channels.
 *
 * Replaces 6-12+ individual EventSource connections per page with a single
 * connection, eliminating reconnect storms and thundering herd issues.
 *
 * Usage:
 *   const unsub = UnifiedSseManager.instance.subscribe('broadcast', (event) => { ... });
 *   // later:
 *   unsub();
 */

import { fetchSseTicket } from "./auth";
import { API_BASE } from "../constants/api";

export type UnifiedSseCallback = (event: Record<string, unknown>) => void;

interface Subscription {
  channel: string;
  callback: UnifiedSseCallback;
}

const RECONNECT_BASE_MS = 3000;
const MAX_BACKOFF_MS = 30_000;
const STABILITY_WINDOW_MS = 5000;
const CHANNEL_DEBOUNCE_MS = 150; // debounce channel changes (multiple hooks mounting)
const KEEP_ALIVE_TYPE = "keep_alive";
const SSE_PATH = "/api/stream/unified";

export class UnifiedSseManager {
  private static _instance: UnifiedSseManager | null = null;

  static get instance(): UnifiedSseManager {
    if (!this._instance) this._instance = new UnifiedSseManager();
    return this._instance;
  }

  private subscriptions = new Map<string, Subscription>();
  private subIdCounter = 0;
  private es: EventSource | null = null;
  private backoffMs = RECONNECT_BASE_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private channelDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private _connected = false;
  private connectedListeners = new Set<() => void>();

  // Track last event IDs per channel for gap protection
  private lastEventIds = new Map<string, string>();

  get connected(): boolean {
    return this._connected;
  }

  /**
   * Subscribe to a channel. Returns an unsubscribe function.
   *
   * Channel names: 'broadcast', 'activity', 'window:<windowId>'
   */
  subscribe(channel: string, callback: UnifiedSseCallback): () => void {
    const id = String(++this.subIdCounter);
    this.subscriptions.set(id, { channel, callback });
    this.scheduleChannelChange();

    return () => {
      this.subscriptions.delete(id);
      this.scheduleChannelChange();
    };
  }

  /** Register a listener for connected state changes */
  onConnectedChange(listener: () => void): () => void {
    this.connectedListeners.add(listener);
    return () => this.connectedListeners.delete(listener);
  }

  /** Get the current set of active channels */
  private getActiveChannels(): Set<string> {
    const channels = new Set<string>();
    for (const sub of this.subscriptions.values()) {
      channels.add(sub.channel);
    }
    return channels;
  }

  /**
   * Debounce channel changes — when multiple hooks mount within 150ms,
   * batch their channel additions into one reconnect.
   */
  private scheduleChannelChange(): void {
    if (this.channelDebounceTimer) clearTimeout(this.channelDebounceTimer);
    this.channelDebounceTimer = setTimeout(() => {
      this.channelDebounceTimer = null;
      this.reconcileConnection();
    }, CHANNEL_DEBOUNCE_MS);
  }

  /**
   * Decide whether to connect, reconnect (channel set changed), or disconnect.
   */
  private reconcileConnection(): void {
    const channels = this.getActiveChannels();

    if (channels.size === 0) {
      // No subscribers — disconnect
      this.disconnect();
      return;
    }

    // Check if current connection already covers the right channels
    if (this.es && this.currentChannels && setsEqual(channels, this.currentChannels)) {
      return; // Already connected with the right channels
    }

    // Need to (re)connect with updated channels
    this.disconnect();
    void this.connect(channels);
  }

  private currentChannels: Set<string> | null = null;

  private async connect(channels: Set<string>): Promise<void> {
    if (this.destroyed) return;

    this.currentChannels = new Set(channels);
    const channelsParam = Array.from(channels).join(",");

    // Build lastEventIds param for gap protection
    let lastEventIdsParam = "";
    const pairs: string[] = [];
    for (const ch of channels) {
      const lastId = this.lastEventIds.get(ch);
      if (lastId) pairs.push(`${ch}=${lastId}`);
    }
    if (pairs.length > 0) lastEventIdsParam = `&lastEventIds=${encodeURIComponent(pairs.join(","))}`;

    const ticketQs = await fetchSseTicket(SSE_PATH);
    if (this.destroyed || this.subscriptions.size === 0) return;

    const url = `${API_BASE}${SSE_PATH}${ticketQs}${ticketQs ? "&" : "?"}channels=${encodeURIComponent(channelsParam)}${lastEventIdsParam}`;

    const es = new EventSource(url);
    this.es = es;

    let connectedAt = 0;

    es.onopen = () => {
      connectedAt = Date.now();
      this.setConnected(true);
      // Reset backoff only after stability window
      setTimeout(() => {
        if (this.es === es && connectedAt > 0) {
          this.backoffMs = RECONNECT_BASE_MS;
        }
      }, STABILITY_WINDOW_MS);
    };

    es.onmessage = (ev) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(ev.data as string);
      } catch {
        return;
      }

      const type = data.type as string | undefined;

      // Keep-alive — ignore
      if (type === KEEP_ALIVE_TYPE) return;

      // Server error — reconnect with fresh ticket
      if (type === "error") {
        console.warn("[UnifiedSSE] Server error — reconnecting:", data.message);
        this.handleDisconnect();
        return;
      }

      // Extract channel from _ch field, then strip it before dispatching
      const ch = (data._ch as string) || "broadcast";
      delete data._ch;

      // Track last event ID for gap protection
      const eventId = data._id as string | undefined;
      if (eventId) {
        this.lastEventIds.set(ch, eventId);
        delete data._id;
      }

      // Dispatch to all subscribers for this channel
      for (const sub of this.subscriptions.values()) {
        if (sub.channel === ch) {
          try {
            sub.callback(data);
          } catch (err) {
            console.error(`[UnifiedSSE] Subscriber error on channel ${ch}:`, err);
          }
        }
      }
    };

    es.onerror = () => {
      this.handleDisconnect();
    };
  }

  private handleDisconnect(): void {
    this.setConnected(false);
    this.closeEventSource();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer) return;

    const jitter = Math.random() * 2000;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
      const channels = this.getActiveChannels();
      if (channels.size > 0) {
        void this.connect(channels);
      }
    }, this.backoffMs + jitter);
  }

  private closeEventSource(): void {
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    this.currentChannels = null;
  }

  private disconnect(): void {
    this.closeEventSource();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.setConnected(false);
  }

  private setConnected(value: boolean): void {
    if (this._connected === value) return;
    this._connected = value;
    for (const listener of this.connectedListeners) {
      try { listener(); } catch { /* ignore */ }
    }
  }

  /** Tear down everything (for tests or hot-reload) */
  destroy(): void {
    this.destroyed = true;
    this.disconnect();
    if (this.channelDebounceTimer) {
      clearTimeout(this.channelDebounceTimer);
      this.channelDebounceTimer = null;
    }
    this.subscriptions.clear();
    this.lastEventIds.clear();
    UnifiedSseManager._instance = null;
  }
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}
