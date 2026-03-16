/**
 * Format a Unix-ms timestamp as HH:MM:SS (24h, stable across locales).
 * If the event is NOT from today, prepends the short date: "Mar 16 00:41:44".
 * This matters for the Director feed which backfills historical events.
 */
export function fmtTime(ts: number): string {
  if (!ts || ts <= 0) return "--:--:--";
  try {
    const d = new Date(ts);
    const now = new Date();
    const timeStr = d.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    // Show date prefix when the event is from a different calendar day.
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) return timeStr;
    const dateStr = d.toLocaleDateString("en-GB", { month: "short", day: "numeric" });
    return `${dateStr} ${timeStr}`;
  } catch {
    return "--:--:--";
  }
}

export function fmtTimeShort(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString("en-GB");
}

export function truncate(s: string | undefined, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/**
 * Human-readable relative time with full range: seconds → minutes → hours → days.
 * Negative diff (clock skew, future events) shows "just now".
 */
export function relativeTime(ts: number): string {
  if (!ts || ts <= 0) return "—";
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 2) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

