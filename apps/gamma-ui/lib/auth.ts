/**
 * lib/auth.ts — Shared auth utilities for Gamma UI apps.
 *
 * Previously `systemAuthHeaders` lived in `hooks/useSessionRegistry`, which made
 * it awkward for non-hook modules and caused a systemic import violation across
 * SentinelApp, AgentMonitorApp, and KernelMonitorApp.  This module is the single
 * canonical home.  The hook re-exports from here for backwards compatibility.
 */

import { API_BASE } from "../constants/api";

const SYSTEM_TOKEN = import.meta.env.VITE_GAMMA_SYSTEM_TOKEN ?? "";

/**
 * Returns the standard system-auth header map.
 * Callers must check that the token is non-empty before trusting a 200 response.
 */
export function systemAuthHeaders(): Record<string, string> {
  return { "X-Gamma-System-Token": SYSTEM_TOKEN };
}

/**
 * Exchange the system token for a short-lived, single-use SSE ticket.
 * Returns a `?ticket=…` query string (including the leading `?`) on success,
 * or `""` when the ticket endpoint is unavailable or returns an error.
 *
 * The ticket pattern avoids embedding the long-lived system token in the SSE URL
 * (where it would appear in server logs, Referrer headers, and browser history).
 */
export async function fetchSseTicket(streamPath: string): Promise<string> {
  try {
    const res = await fetch(`${API_BASE}/api/system/sse-ticket`, {
      method: "POST",
      headers: { ...systemAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ stream: streamPath }),
    });
    if (!res.ok) return "";
    const body = (await res.json()) as { ticket?: string };
    if (typeof body.ticket === "string" && body.ticket.length > 0) {
      return `?ticket=${encodeURIComponent(body.ticket)}`;
    }
  } catch {
    // Ticket endpoint unavailable — caller falls back to unauthenticated connection.
  }
  return "";
}
