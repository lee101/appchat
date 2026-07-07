import { describe, expect, it } from 'vitest';
import { parseSseBuffer } from '../src/sse';

describe('parseSseBuffer', () => {
  it('parses complete events', () => {
    const out = parseSseBuffer('', 'event: token\ndata: {"text":"hi"}\n\n');
    expect(out.rest).toBe('');
    expect(out.events).toEqual([{ event: 'token', data: { text: 'hi' } }]);
  });

  it('keeps partial events for the next chunk', () => {
    const first = parseSseBuffer('', 'event: token\ndata: {"text"');
    expect(first.events).toHaveLength(0);
    const second = parseSseBuffer(first.rest, ':"ok"}\n\n');
    expect(second.events[0]).toEqual({ event: 'token', data: { text: 'ok' } });
  });
});
