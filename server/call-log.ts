import { randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync } from 'node:fs';
import { open, writeFile, rename } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { finished } from 'node:stream/promises';
import { z } from 'zod';

export const diagnosticSchema = z.object({
  type: z.literal('diagnostic'),
  name: z.enum(['connected', 'vad_started', 'vad_stopped', 'cloud_speech_started', 'cloud_speech_stopped',
    'playback_started', 'playback_stopped', 'playback_done', 'playback_chunk', 'audio_dropped', 'mute', 'error', 'capture_stats', 'visibility']),
  clientMs: z.number().finite().min(0).max(86400000),
  details: z.record(z.string().max(80), z.union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()])).refine(value => Object.keys(value).length <= 32),
}).strict();

function wavHeader(bytes: number, rate: number) {
  const b = Buffer.alloc(44);
  b.write('RIFF'); b.writeUInt32LE(bytes + 36, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(bytes, 40);
  return b;
}

export interface CallJournal {
  id: string;
  directory: string;
  record(source: string, event: Record<string, unknown>, context?: Record<string, unknown>): void;
  input(pcm: Buffer, context?: Record<string, unknown>): void;
  close(reason?: string): Promise<void>;
}

/** Append-only event journal + lossless PCM. No disk I/O is awaited on the audio path. */
export function createCallJournal({ root, model, voice, secrets = [], onError = () => {} }: {
  root: string; model: string; voice: string; secrets?: string[]; onError?: () => void;
}): CallJournal {
  const startedAt = new Date().toISOString(), started = performance.now();
  const id = `${startedAt.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const directory = resolve(root, startedAt.slice(0, 10), id);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const streams = {
    events: createWriteStream(resolve(directory, 'events.jsonl'), { flags: 'wx', mode: 0o600 }),
    input: createWriteStream(resolve(directory, 'input.wav'), { flags: 'wx', mode: 0o600 }),
    output: createWriteStream(resolve(directory, 'model-output.wav'), { flags: 'wx', mode: 0o600 }),
  };
  const bytes = { input: 0, output: 0 }, chunks = { input: 0, output: 0 }, counts: Record<string, number> = {};
  let seq = 0, ended = false, failed = false, closing: Promise<void> | undefined;
  const fail = () => { if (failed) return; failed = true; queueMicrotask(onError); };
  for (const stream of Object.values(streams)) stream.on('error', fail);
  streams.input.write(wavHeader(0, 16000)); streams.output.write(wavHeader(0, 24000));
  function scrub(value: unknown): unknown {
    if (typeof value === 'string') {
      for (const secret of secrets) if (secret) value = (value as string).replaceAll(secret, '[REDACTED]');
      return (value as string).replace(/Bearer\s+[^\s"\\]+/gi, 'Bearer [REDACTED]');
    }
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key,
      /^(authorization|api_?key|access_token|credentials)$/i.test(key) ? '[REDACTED]' : scrub(v)]));
    return value;
  }
  function write(source: string, event: Record<string, unknown>, context: Record<string, unknown> = {}) {
    if (ended || failed) return;
    if (Object.values(streams).reduce((sum, stream) => sum + stream.writableLength, 0) > 8 * 1024 * 1024) { fail(); return; }
    const type = typeof event.type === 'string' ? event.type : 'unknown';
    counts[`${source}:${type}`] = (counts[`${source}:${type}`] ?? 0) + 1;
    const row = { version: 1, callId: id, seq: ++seq, at: new Date().toISOString(), elapsedMs: +(performance.now() - started).toFixed(3), source, context, event };
    streams.events.write(JSON.stringify(scrub(row)) + '\n');
  }
  function audio(kind: 'input' | 'output', pcm: Buffer) {
    const offsetBytes = bytes[kind]; bytes[kind] += pcm.length; chunks[kind]++;
    streams[kind].write(pcm);
    return { file: kind === 'input' ? 'input.wav' : 'model-output.wav', offsetBytes, bytes: pcm.length,
      sampleRate: kind === 'input' ? 16000 : 24000, packet: chunks[kind] };
  }
  const journal: CallJournal = {
    id, directory,
    record(source, event, context) {
      if (ended || failed) return;
      // Only the model's incoming audio is stored once. Other directions reference counts.
      if (event.type === 'response.audio.delta' && typeof event.delta === 'string') {
        const { delta, ...rest } = event;
        write(source, { ...rest, audio: audio('output', Buffer.from(delta, 'base64')) }, context);
      } else if (typeof event.audio === 'string') {
        const { audio: data, ...rest } = event;
        write(source, { ...rest, audioBytes: Buffer.byteLength(data, 'base64') }, context);
      } else write(source, event, context);
    },
    input(pcm, context) { if (!ended && !failed) write('client', { type: 'capture.packet', audio: audio('input', pcm) }, context); },
    close(reason = 'closed') {
      if (closing) return closing;
      write('server', { type: 'call.closed', reason, inputBytes: bytes.input, outputBytes: bytes.output });
      ended = true;
      closing = (async () => {
        const results = await Promise.allSettled(Object.values(streams).map(async stream => {
          const done = finished(stream); stream.end(); await done;
        }));
        if (results.some(result => result.status === 'rejected')) fail();
        for (const [kind, name, rate] of [['input', 'input.wav', 16000], ['output', 'model-output.wav', 24000]] as const) {
          const file = await open(resolve(directory, name), 'r+');
          try { await file.write(wavHeader(bytes[kind], rate), 0, 44, 0); }
          finally { await file.close(); }
        }
        await writeFile(resolve(directory, 'summary.json.tmp'), JSON.stringify({ version: 1, callId: id, startedAt,
          endedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - started), reason,
          complete: !failed, model, voice, bytes, chunks, counts,
          audioNote: 'input.wav = received microphone PCM; model-output.wav = all generated chunks, including discarded/unheard audio. Actual playout is in browser diagnostics.',
        }, null, 2) + '\n', { mode: 0o600 });
        await rename(resolve(directory, 'summary.json.tmp'), resolve(directory, 'summary.json'));
        // Publish directly in the watched root. Recursive fs.watch can miss files created
        // immediately inside brand-new nested directories before their watches attach.
        const marker = resolve(root, `${id}.complete.json`);
        await writeFile(`${marker}.tmp`, JSON.stringify({ callId: id, startedAt, directory: relative(root, directory) }) + '\n', { mode: 0o600 });
        await rename(`${marker}.tmp`, marker);
      })().catch(() => { fail(); });
      return closing;
    },
  };
  journal.record('server', { type: 'call.opened', startedAt, model, voice, inputRate: 16000, outputRate: 24000 });
  return journal;
}
