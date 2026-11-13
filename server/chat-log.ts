import { randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { finished } from 'node:stream/promises';

export function diagnosticError(error: unknown, depth = 0): Record<string, unknown> {
  if (!(error instanceof Error)) return { message: String(error) };
  return { name: error.name, message: error.message, stack: error.stack,
    ...('code' in error ? { code: error.code } : {}),
    ...(error.cause instanceof Error && depth < 3 ? { cause: diagnosticError(error.cause, depth + 1) } : {}) };
}

export type ChatOutcome = 'success' | 'error' | 'timeout' | 'cancelled' | 'rejected';
export interface ChatJournal {
  id: string;
  record(event: Record<string, unknown>): void;
  close(result: { outcome: ChatOutcome; httpStatus: number; [key: string]: unknown }): Promise<void>;
}

/** Server-only diagnostics. Buffered, bounded writes; storage failures do not fail chats. */
export function createChatJournal({ root, requestId, model, secrets = [], onError = () => {} }: {
  root: string; requestId: string; model: string; secrets?: string[]; onError?: () => void;
}): ChatJournal {
  const startedAt = new Date().toISOString(), started = performance.now();
  const id = `${startedAt.replace(/[:.]/g, '-')}-${randomUUID()}`;
  const directory = resolve(root, startedAt.slice(0, 10), id);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stream = createWriteStream(resolve(directory, 'events.jsonl'), { flags: 'wx', mode: 0o600 });
  const hidden = [...secrets].filter(Boolean).sort((a, b) => b.length - a.length);
  let failed = false, ended = false, seq = 0, bytes = 0, truncatedEvents = 0;
  let closing: Promise<void> | undefined;
  const fail = () => { if (!failed) { failed = true; onError(); } };
  stream.on('error', fail);
  function scrub(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
    if (typeof value === 'string') {
      for (const secret of hidden) value = (value as string).replaceAll(secret, '[REDACTED]');
      return (value as string).replace(/Bearer\s+[^\s"\\]+/gi, 'Bearer [REDACTED]');
    }
    if (!value || typeof value !== 'object') return value;
    if (depth > 24 || seen.has(value)) return '[OMITTED: recursive/deep value]';
    seen.add(value);
    const clean = Array.isArray(value) ? value.map(item => scrub(item, seen, depth + 1))
      : Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
        /^(?:authorization|(?:x[-_])?api[-_]?key|access[-_]?token|refresh[-_]?token|token|password|secret|credentials)$/i.test(key) ? '[REDACTED]'
          : /^(?:reasoning_content|reasoning|analysis)$/i.test(key) ? '[OMITTED: internal reasoning]' : scrub(item, seen, depth + 1)]));
    seen.delete(value);
    return clean;
  }
  const counts: Record<string, number> = {};
  const journal: ChatJournal = {
    id,
    record(event) {
      if (ended || failed) return;
      try {
        // Cap both queued I/O and total per-turn output; retain an explicit omission marker.
        const type = typeof event.type === 'string' ? event.type : 'unknown';
        counts[type] = (counts[type] ?? 0) + 1;
        let row = JSON.stringify(scrub({ version: 1, chatId: id, requestId, seq: ++seq,
          at: new Date().toISOString(), elapsedMs: +(performance.now() - started).toFixed(3), event })) + '\n';
        if (Buffer.byteLength(row) > 2 * 1024 * 1024 || bytes > 16 * 1024 * 1024) {
          truncatedEvents++;
          row = JSON.stringify({ version: 1, chatId: id, requestId, seq, at: new Date().toISOString(),
            event: { type: 'log.omitted', originalType: type, reason: 'size-limit' } }) + '\n';
        }
        if (stream.writableLength + Buffer.byteLength(row) > 4 * 1024 * 1024) { fail(); return; }
        bytes += Buffer.byteLength(row);
        stream.write(row);
      } catch { fail(); }
    },
    close(result) {
      if (closing) return closing;
      journal.record({ type: 'request.finished', ...result });
      ended = true;
      closing = (async () => {
        const done = finished(stream); stream.end();
        try { await done; } catch { fail(); }
        const summary = scrub({ version: 1, chatId: id, requestId, model, startedAt,
          endedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - started),
          ...result, counts, logging: { complete: !failed && truncatedEvents === 0, truncatedEvents } });
        await writeFile(resolve(directory, 'summary.json.tmp'), JSON.stringify(summary, null, 2) + '\n', { mode: 0o600 });
        await rename(resolve(directory, 'summary.json.tmp'), resolve(directory, 'summary.json'));
      })().catch(fail);
      return closing;
    },
  };
  journal.record({ type: 'request.started', model });
  return journal;
}
