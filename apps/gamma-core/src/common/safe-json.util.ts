/**
 * Safe JSON parsing utility.
 *
 * Wraps JSON.parse in a try/catch to prevent unhandled SyntaxError
 * exceptions from corrupted or malformed data (Redis, WebSocket, etc.).
 */

/** Parse JSON safely, returning `fallback` on failure. */
export function safeJsonParse<T>(json: string, fallback: T): T;
export function safeJsonParse<T>(json: string): T | null;
export function safeJsonParse<T>(json: string, fallback?: T): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback ?? null;
  }
}
