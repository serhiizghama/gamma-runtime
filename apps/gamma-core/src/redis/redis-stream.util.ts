/**
 * Shared Redis Stream utilities.
 *
 * Replaces duplicated inline helpers across gateway, scaffold, sessions,
 * activity-stream, SSE, and system controllers.
 */

/**
 * Flatten an object into [key, value, key, value, ...] for Redis XADD.
 * Null/undefined values are skipped; non-strings are JSON-serialized.
 */
export function flattenEntry(obj: Record<string, unknown>): string[] {
  const args: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    args.push(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  return args;
}

/**
 * Convert a Redis Stream field array [k1, v1, k2, v2, ...] to an object.
 * - JSON objects/arrays and booleans/null are parsed via JSON.parse
 * - Numeric strings (timestamps, counters) are converted to numbers
 * - Everything else remains a string
 */
export function parseStreamFields(fields: string[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const key = fields[i];
    const raw = fields[i + 1];
    if (
      raw.startsWith('{') ||
      raw.startsWith('[') ||
      raw === 'true' ||
      raw === 'false' ||
      raw === 'null'
    ) {
      try {
        obj[key] = JSON.parse(raw);
        continue;
      } catch {
        // fall through to string
      }
    }
    if (/^-?\d+(\.\d+)?$/.test(raw)) {
      obj[key] = Number(raw);
      continue;
    }
    obj[key] = raw;
  }
  return obj;
}

/** Convert kebab-case / snake_case id to PascalCase */
export function pascal(id: string): string {
  return id
    .replace(/[-_]+(.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^(.)/, (_, c: string) => c.toUpperCase());
}
