import { flattenEntry, parseStreamFields, pascal } from '../../src/redis/redis-stream.util';

// ═══════════════════════════════════════════════════════════════════════
// flattenEntry
// ═══════════════════════════════════════════════════════════════════════

describe('flattenEntry', () => {
  it('flattens a simple object into [key, value] pairs', () => {
    expect(flattenEntry({ a: 'hello', b: 'world' })).toEqual([
      'a', 'hello',
      'b', 'world',
    ]);
  });

  it('JSON-stringifies non-string values', () => {
    expect(flattenEntry({ count: 42 })).toEqual(['count', '42']);
    expect(flattenEntry({ flag: true })).toEqual(['flag', 'true']);
    expect(flattenEntry({ nested: { x: 1 } })).toEqual([
      'nested', '{"x":1}',
    ]);
  });

  it('skips null and undefined values', () => {
    expect(flattenEntry({ a: 'keep', b: null, c: undefined, d: 'also' }))
      .toEqual(['a', 'keep', 'd', 'also']);
  });

  it('returns an empty array for an empty object', () => {
    expect(flattenEntry({})).toEqual([]);
  });

  it('handles an array value by stringifying it', () => {
    expect(flattenEntry({ list: [1, 2, 3] })).toEqual([
      'list', '[1,2,3]',
    ]);
  });

  it('preserves string values without double-encoding', () => {
    expect(flattenEntry({ raw: '{"already":"json"}' })).toEqual([
      'raw', '{"already":"json"}',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// parseStreamFields
// ═══════════════════════════════════════════════════════════════════════

describe('parseStreamFields', () => {
  it('converts a flat key/value array to an object', () => {
    expect(parseStreamFields(['name', 'test', 'kind', 'event']))
      .toEqual({ name: 'test', kind: 'event' });
  });

  it('parses JSON objects embedded in values', () => {
    const result = parseStreamFields(['data', '{"x":1}']);
    expect(result).toEqual({ data: { x: 1 } });
  });

  it('parses JSON arrays embedded in values', () => {
    const result = parseStreamFields(['items', '[1,2,3]']);
    expect(result).toEqual({ items: [1, 2, 3] });
  });

  it('parses boolean strings', () => {
    expect(parseStreamFields(['a', 'true', 'b', 'false']))
      .toEqual({ a: true, b: false });
  });

  it('parses "null" as null', () => {
    expect(parseStreamFields(['val', 'null'])).toEqual({ val: null });
  });

  it('converts numeric strings to numbers', () => {
    expect(parseStreamFields(['ts', '1710000000000', 'neg', '-5', 'float', '3.14']))
      .toEqual({ ts: 1710000000000, neg: -5, float: 3.14 });
  });

  it('keeps non-numeric, non-JSON strings as strings', () => {
    expect(parseStreamFields(['msg', 'hello world']))
      .toEqual({ msg: 'hello world' });
  });

  it('falls back to string when JSON-like value is invalid', () => {
    expect(parseStreamFields(['bad', '{not json}']))
      .toEqual({ bad: '{not json}' });
  });

  it('handles an empty array', () => {
    expect(parseStreamFields([])).toEqual({});
  });

  it('ignores a trailing key with no value (odd-length array)', () => {
    // The loop condition `i + 1 < fields.length` should skip the last orphan key
    expect(parseStreamFields(['a', 'val', 'orphan']))
      .toEqual({ a: 'val' });
  });

  it('coerces types during flattenEntry→parseStreamFields cycle (lossy for digit-only strings and JSON strings)', () => {
    const original = { kind: 'tool_call', ts: '1710000000000', payload: '{"x":1}' };
    const flat = flattenEntry(original);
    const parsed = parseStreamFields(flat);
    // KNOWN LOSSY BEHAVIOR:
    // - ts: '1710000000000' (string) → 1710000000000 (number)
    // - payload: '{"x":1}' (string) → { x: 1 } (object)
    // This means digit-only strings and JSON-containing strings change type
    // after a Redis stream roundtrip. Callers storing phone numbers or other
    // numeric-looking strings should be aware of this coercion.
    expect(parsed).toEqual({
      kind: 'tool_call',
      ts: 1710000000000,
      payload: { x: 1 },
    });
    // Verify the type change explicitly
    expect(typeof parsed.ts).toBe('number');
    expect(typeof parsed.payload).toBe('object');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// pascal
// ═══════════════════════════════════════════════════════════════════════

describe('pascal', () => {
  it('converts kebab-case to PascalCase', () => {
    expect(pascal('my-app')).toBe('MyApp');
  });

  it('converts snake_case to PascalCase', () => {
    expect(pascal('my_app')).toBe('MyApp');
  });

  it('handles a single word', () => {
    expect(pascal('notes')).toBe('Notes');
  });

  it('handles mixed delimiters', () => {
    expect(pascal('my-cool_app')).toBe('MyCoolApp');
  });

  it('handles consecutive delimiters', () => {
    expect(pascal('a--b')).toBe('AB');
  });

  it('capitalizes first letter even if already uppercase', () => {
    expect(pascal('Already')).toBe('Already');
  });
});
