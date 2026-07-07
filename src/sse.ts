export type SseEvent = {
  event: string;
  data: unknown;
};

export function parseSseBuffer(buffer: string, chunk: string): { events: SseEvent[]; rest: string } {
  const input = buffer + chunk;
  const parts = input.split(/\n\n/);
  const rest = parts.pop() ?? '';
  const events: SseEvent[] = [];

  for (const part of parts) {
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of part.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) continue;
    const raw = dataLines.join('\n');
    try {
      events.push({ event, data: JSON.parse(raw) });
    } catch {
      events.push({ event, data: raw });
    }
  }

  return { events, rest };
}
