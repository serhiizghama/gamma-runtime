import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import type { AgentStatus, SessionRecord, TokenUsage } from '@gamma/types';
import { REDIS_KEYS } from '@gamma/types';

const TTL_SECONDS = 86400; // 24 hours

@Injectable()
export class SessionRegistryService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // ── Key helpers ───────────────────────────────────────────────────────

  private hashKey(sessionKey: string): string {
    return `${REDIS_KEYS.SESSION_REGISTRY_PREFIX}${sessionKey}`;
  }

  private contextKey(sessionKey: string): string {
    return `${REDIS_KEYS.SESSION_CONTEXT_PREFIX}${sessionKey}`;
  }

  // ── Serialization ─────────────────────────────────────────────────────

  /**
   * Convert a partial SessionRecord to a flat [field, value, ...] array
   * suitable for Redis HSET. Numbers are stored as strings; tokenUsage
   * is flattened into prefixed sub-fields.
   */
  private serialize(record: Partial<SessionRecord> & { sessionKey: string }): string[] {
    const args: string[] = [];
    const { tokenUsage, ...rest } = record;

    for (const [k, v] of Object.entries(rest)) {
      if (v === undefined || v === null) continue;
      args.push(k, String(v));
    }

    if (tokenUsage) {
      args.push(
        'tokenUsage_inputTokens',    String(tokenUsage.inputTokens),
        'tokenUsage_outputTokens',   String(tokenUsage.outputTokens),
        'tokenUsage_cacheReadTokens',  String(tokenUsage.cacheReadTokens),
        'tokenUsage_cacheWriteTokens', String(tokenUsage.cacheWriteTokens),
        'tokenUsage_contextUsedPct', String(tokenUsage.contextUsedPct),
      );
    }

    return args;
  }

  /**
   * Reconstruct a SessionRecord from a raw Redis hash (all values are strings).
   */
  private deserialize(hash: Record<string, string>): SessionRecord {
    return {
      sessionKey:          hash.sessionKey           ?? '',
      windowId:            hash.windowId             ?? '',
      appId:               hash.appId                ?? '',
      status:              (hash.status as AgentStatus) ?? 'idle',
      createdAt:           Number(hash.createdAt     ?? 0),
      lastActiveAt:        Number(hash.lastActiveAt  ?? 0),
      runCount:            Number(hash.runCount      ?? 0),
      systemPromptSnippet: hash.systemPromptSnippet  ?? '',
      tokenUsage: {
        inputTokens:      Number(hash.tokenUsage_inputTokens    ?? 0),
        outputTokens:     Number(hash.tokenUsage_outputTokens   ?? 0),
        cacheReadTokens:  Number(hash.tokenUsage_cacheReadTokens  ?? 0),
        cacheWriteTokens: Number(hash.tokenUsage_cacheWriteTokens ?? 0),
        contextUsedPct:   Number(hash.tokenUsage_contextUsedPct ?? 0),
      },
    };
  }

  // ── Real-time broadcast ───────────────────────────────────────────────

  /**
   * Push a session_registry_update snapshot to the SSE broadcast stream
   * so all connected clients see registry changes instantly.
   * Best-effort — errors are silently swallowed to never block mutations.
   */
  private broadcastUpdate(): void {
    this.getAll()
      .then((records) =>
        this.redis.xadd(
          REDIS_KEYS.SSE_BROADCAST, '*',
          'type', 'session_registry_update',
          'records', JSON.stringify(records),
        ),
      )
      .catch(() => {
        // best-effort; SSE broadcast failure must never block normal operations
      });
  }

  // ── Public API ────────────────────────────────────────────────────────

  /**
   * Create or partially update a session record.
   * Only the provided fields are written; existing fields are preserved.
   * Resets the 24 h TTL on every call.
   */
  async upsert(record: Partial<SessionRecord> & { sessionKey: string }): Promise<void> {
    const key = this.hashKey(record.sessionKey);
    const args = this.serialize(record);
    if (args.length === 0) return;

    await this.redis.hset(key, ...args);
    await this.redis.expire(key, TTL_SECONDS);
    this.broadcastUpdate();
  }

  /**
   * Atomically mark a run as started: set status=running, increment runCount,
   * update lastActiveAt — all in a single pipeline. Resets TTL.
   */
  async onRunStart(sessionKey: string): Promise<void> {
    const key = this.hashKey(sessionKey);
    const pipeline = this.redis.pipeline();
    pipeline.hset(key,
      'status',       'running',
      'lastActiveAt', String(Date.now()),
    );
    pipeline.hincrby(key, 'runCount', 1);
    pipeline.expire(key, TTL_SECONDS);
    await pipeline.exec();
    this.broadcastUpdate();
  }

  /** Persist the full system prompt string. Resets TTL. */
  async setContext(sessionKey: string, prompt: string): Promise<void> {
    await this.redis.set(this.contextKey(sessionKey), prompt, 'EX', TTL_SECONDS);
    // context-only writes don't change the registry snapshot, no broadcast needed
  }

  /** Retrieve the full system prompt string, or null if not present. */
  async getContext(sessionKey: string): Promise<string | null> {
    return this.redis.get(this.contextKey(sessionKey));
  }

  /**
   * Accumulate token counts from a completed run into the running totals.
   * Uses HINCRBY for integer fields; overwrites contextUsedPct with the
   * latest value. Resets TTL.
   */
  async accumulateTokens(sessionKey: string, usage: TokenUsage): Promise<void> {
    const key = this.hashKey(sessionKey);
    const pipeline = this.redis.pipeline();
    pipeline.hincrby(key, 'tokenUsage_inputTokens',    usage.inputTokens);
    pipeline.hincrby(key, 'tokenUsage_outputTokens',   usage.outputTokens);
    pipeline.hincrby(key, 'tokenUsage_cacheReadTokens',  usage.cacheReadTokens);
    pipeline.hincrby(key, 'tokenUsage_cacheWriteTokens', usage.cacheWriteTokens);
    pipeline.hset(key,    'tokenUsage_contextUsedPct', String(usage.contextUsedPct));
    pipeline.expire(key, TTL_SECONDS);
    await pipeline.exec();
    this.broadcastUpdate();
  }

  /** Delete both the hash and the context string for a session. */
  async remove(sessionKey: string): Promise<void> {
    await this.redis.del(this.hashKey(sessionKey), this.contextKey(sessionKey));
    this.broadcastUpdate();
  }

  /** Return all registry records (SCAN-based, safe for large keyspaces). */
  async getAll(): Promise<SessionRecord[]> {
    const pattern = `${REDIS_KEYS.SESSION_REGISTRY_PREFIX}*`;
    const keys = await this.scanKeys(pattern);
    if (keys.length === 0) return [];

    const pipeline = this.redis.pipeline();
    for (const key of keys) pipeline.hgetall(key);

    const results = await pipeline.exec();
    if (!results) return [];

    const records: SessionRecord[] = [];
    for (const [err, hash] of results) {
      if (err || !hash || typeof hash !== 'object') continue;
      const h = hash as Record<string, string>;
      if (!h.sessionKey) continue;
      records.push(this.deserialize(h));
    }
    return records;
  }

  /** Return a single registry record, or null if not found. */
  async getOne(sessionKey: string): Promise<SessionRecord | null> {
    const hash = await this.redis.hgetall(this.hashKey(sessionKey));
    if (!hash || !hash.sessionKey) return null;
    return this.deserialize(hash);
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== '0');
    return keys;
  }
}
