import { Injectable, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'child_process';
import { promisify } from 'util';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { GatewayWsService } from '../gateway/gateway-ws.service';
import type { SystemHealthReport } from '@gamma/types';
import { REDIS_KEYS } from '@gamma/types';

const execFileAsync = promisify(execFile);

/**
 * System health metrics collector (spec §15).
 * Gathers CPU, RAM, Redis, Gateway, and event lag data.
 */
@Injectable()
export class SystemHealthService {
  private readonly gatewayHttpUrl: string;
  private readonly gatewayToken: string;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
    @Optional() private readonly gatewayWs?: GatewayWsService,
  ) {
    const wsUrl = this.config.get('OPENCLAW_GATEWAY_URL', 'ws://localhost:18789');
    this.gatewayHttpUrl = wsUrl
      .replace('ws://', 'http://')
      .replace('wss://', 'https://');
    this.gatewayToken = this.config.get('OPENCLAW_GATEWAY_TOKEN', '');
  }

  async getHealth(): Promise<SystemHealthReport> {
    const [
      [redisOk, redisLatencyMs],
      [gwOk, gwLatencyMs],
      { cpuPct, ramUsedMb, ramTotalMb },
      eventLag,
    ] = await Promise.all([
      this.pingRedis(),
      this.pingGateway(),
      this.getSystemMetrics(),
      this.getEventLag(),
    ]);

    const ramUsedPct = ramTotalMb > 0
      ? Math.round((ramUsedMb / ramTotalMb) * 100)
      : 0;

    // Check watchdog heartbeat (only if Redis is up)
    const watchdogOnline = redisOk ? await this.checkWatchdogHeartbeat() : false;

    // Determine overall status
    let status: SystemHealthReport['status'] = 'ok';
    if (!redisOk) {
      status = 'error'; // Redis is critical
    } else if (!gwOk) {
      status = 'degraded'; // Gateway down but Redis up
    }

    // Watchdog offline is a warning, but doesn't override 'error'
    let statusNote: string | undefined;
    if (redisOk && !watchdogOnline) {
      if (status === 'ok') status = 'degraded';
      statusNote = 'WARNING: Watchdog Offline';
    }

    return {
      ts: Date.now(),
      status,
      ...(statusNote ? { statusNote } : {}),
      cpu: { usagePct: cpuPct },
      ram: { usedMb: ramUsedMb, totalMb: ramTotalMb, usedPct: ramUsedPct },
      redis: { connected: redisOk, latencyMs: redisLatencyMs },
      gateway: { connected: gwOk, latencyMs: gwLatencyMs },
      eventLag,
      watchdog: { online: watchdogOnline },
    } as SystemHealthReport;
  }

  // ── Redis ping ──────────────────────────────────────────────────────

  private async pingRedis(): Promise<[boolean, number]> {
    const t0 = Date.now();
    try {
      await this.redis.ping();
      return [true, Date.now() - t0];
    } catch {
      return [false, -1];
    }
  }

  // ── Gateway ping ────────────────────────────────────────────────────

  private async pingGateway(): Promise<[boolean, number]> {
    // If no token configured, use WS connection status as fallback
    if (!this.gatewayToken) {
      const connected = this.gatewayWs?.isConnected() ?? false;
      return [connected, connected ? 0 : -1];
    }

    const t0 = Date.now();
    try {
      const res = await fetch(`${this.gatewayHttpUrl}/ping`, {
        headers: { Authorization: `Bearer ${this.gatewayToken}` },
        signal: AbortSignal.timeout(2000),
      });
      return [res.ok, Date.now() - t0];
    } catch {
      return [false, -1];
    }
  }

  // ── macOS system metrics ────────────────────────────────────────────

  private async getSystemMetrics(): Promise<{
    cpuPct: number;
    ramUsedMb: number;
    ramTotalMb: number;
  }> {
    try {
      const [vmStatResult, cpuLoadResult, memSizeResult] = await Promise.all([
        execFileAsync('vm_stat'),
        execFileAsync('sysctl', ['-n', 'vm.loadavg']),
        execFileAsync('sysctl', ['-n', 'hw.memsize']),
      ]);

      // ── RAM ──
      // macOS M4: page size = 16384 bytes (16 KB)
      const pageSize = 16384;
      const stdout = vmStatResult.stdout;

      const activePages = parseInt(
        stdout.match(/Pages active:\s+(\d+)/)?.[1] ?? '0',
      );
      const wiredPages = parseInt(
        stdout.match(/Pages wired down:\s+(\d+)/)?.[1] ?? '0',
      );
      const compressedPages = parseInt(
        stdout.match(/Pages occupied by compressor:\s+(\d+)/)?.[1] ?? '0',
      );

      const ramUsedMb = Math.round(
        ((activePages + wiredPages + compressedPages) * pageSize) / 1024 / 1024,
      );

      // Total RAM from hw.memsize (bytes)
      const ramTotalMb = Math.round(
        parseInt(memSizeResult.stdout.trim()) / 1024 / 1024,
      );

      // ── CPU ──
      // Parse 1-minute load average from `sysctl -n vm.loadavg`
      // Output format: "{ 1.23 4.56 7.89 }"
      const loadStr = cpuLoadResult.stdout.trim().replace(/[{}]/g, '').trim();
      const loadAvg1m = parseFloat(loadStr.split(/\s+/)[0] ?? '0');

      // Get CPU core count for normalization
      let cpuCores = 10; // M4 default
      try {
        const coresResult = await execFileAsync('sysctl', ['-n', 'hw.ncpu']);
        cpuCores = parseInt(coresResult.stdout.trim()) || 10;
      } catch {
        // fallback
      }

      // Normalize: (loadAvg / cores) * 100, capped at 100%
      const cpuPct = Math.min(Math.round((loadAvg1m / cpuCores) * 100), 100);

      return { cpuPct, ramUsedMb, ramTotalMb };
    } catch {
      // Fallback if commands fail
      return { cpuPct: -1, ramUsedMb: -1, ramTotalMb: -1 };
    }
  }

  // ── Watchdog heartbeat (§4 Observability) ──────────────────────────

  private static readonly WATCHDOG_HEARTBEAT_KEY = 'gamma:watchdog:heartbeat';
  private static readonly WATCHDOG_STALE_MS = 30_000;

  private async checkWatchdogHeartbeat(): Promise<boolean> {
    try {
      const raw = await this.redis.get(SystemHealthService.WATCHDOG_HEARTBEAT_KEY);
      if (!raw) return false;
      const lastBeat = parseInt(raw, 10);
      if (isNaN(lastBeat)) return false;
      return Date.now() - lastBeat < SystemHealthService.WATCHDOG_STALE_MS;
    } catch {
      return false;
    }
  }

  // ── Event lag (spec §15) ────────────────────────────────────────────

  private async getEventLag(): Promise<SystemHealthReport['eventLag']> {
    try {
      const samples = await this.redis.lrange(REDIS_KEYS.EVENT_LAG, 0, 99);
      if (!samples.length) return null;

      const nums = samples.map(Number).filter((n) => !isNaN(n) && n >= 0);
      if (!nums.length) return null;

      const avgMs = Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
      const maxMs = Math.max(...nums);

      return { avgMs, maxMs, samples: nums.length };
    } catch {
      return null;
    }
  }
}
