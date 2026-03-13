/**
 * API base URL.
 *
 * In the browser: always empty string (Vite proxy handles /api → kernel:3001).
 * In SSR/Node: fallback to localhost:3001 directly.
 */
export const API_BASE: string =
  typeof window === "undefined" ? "http://localhost:3001" : "";
