import { safeJsonParse } from '../../src/common/safe-json.util';

describe('safeJsonParse', () => {
  // ── Success cases ──────────────────────────────────────────────────

  it('parses a valid JSON object', () => {
    expect(safeJsonParse<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses a valid JSON array', () => {
    expect(safeJsonParse<number[]>('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('parses a JSON string literal', () => {
    expect(safeJsonParse<string>('"hello"')).toBe('hello');
  });

  it('parses JSON null', () => {
    expect(safeJsonParse('null')).toBeNull();
  });

  it('parses JSON booleans', () => {
    expect(safeJsonParse('true')).toBe(true);
    expect(safeJsonParse('false')).toBe(false);
  });

  it('parses a JSON number', () => {
    expect(safeJsonParse('42')).toBe(42);
  });

  // ── Fallback (no default) ─────────────────────────────────────────

  it('returns null for malformed JSON when no fallback is given', () => {
    expect(safeJsonParse('{bad')).toBeNull();
  });

  it('returns null for an empty string when no fallback is given', () => {
    expect(safeJsonParse('')).toBeNull();
  });

  // ── Fallback (with default) ───────────────────────────────────────

  it('returns the fallback value for malformed JSON', () => {
    expect(safeJsonParse<string[]>('{bad', [])).toEqual([]);
  });

  it('returns the fallback value for an empty string', () => {
    expect(safeJsonParse<number>('', -1)).toBe(-1);
  });

  it('returns the fallback value for truncated JSON', () => {
    expect(safeJsonParse<object>('{"key":', {})).toEqual({});
  });

  // ── Edge cases ────────────────────────────────────────────────────

  it('returns the parsed value (not the fallback) when JSON is valid', () => {
    expect(safeJsonParse<number[]>('[1]', [99])).toEqual([1]);
  });

  it('handles deeply nested JSON', () => {
    const deep = '{"a":{"b":{"c":true}}}';
    expect(safeJsonParse(deep)).toEqual({ a: { b: { c: true } } });
  });

  it('handles strings that look like JSON but are not', () => {
    expect(safeJsonParse('undefined')).toBeNull();
    expect(safeJsonParse('NaN')).toBeNull();
  });

  // ── Prototype pollution contract ──────────────────────────────────

  it('does NOT strip __proto__ keys (callers must handle prototype pollution)', () => {
    const result = safeJsonParse('{"__proto__": {"admin": true}}');
    // JSON.parse preserves __proto__ as a regular own property — this is expected.
    // Callers using Object.assign or spread must sanitize separately.
    expect(result).toHaveProperty('__proto__');
  });

  it('does NOT strip constructor keys', () => {
    const result = safeJsonParse('{"constructor": {"prototype": {"x": 1}}}');
    expect(result).toHaveProperty('constructor');
  });
});
