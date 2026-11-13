import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createCallJournal } from '../server/call-log.ts';
import { createRealtimeBridge } from '../server/ai/realtime.ts';
import { createHandler } from '../server/handler.ts';
import { summarizeCall } from '../scripts/inspect-call.mjs';

async function fixture(t) {
  await mkdir('agent-tmp', { recursive: true });
  const root = await mkdtemp(resolve('agent-tmp/call-log-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const errors = [];
  const journal = createCallJournal({ root, model: 'test-model', voice: 'test-voice', secrets: ['private-test-secret'], onError: () => errors.push('write-failed') });
  return { root, journal, errors, read: name => readFile(resolve(journal.directory, name)),
    rows: async () => (await readFile(resolve(journal.directory, 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse) };
}

test('call journal persists ordered events and lossless WAV with offsets, redaction and finalized headers', async t => {
  const f = await fixture(t), input = Buffer.from([1, 2, 3, 4]), output = Buffer.from([5, 6, 7, 8, 9, 10]);
  f.journal.record('provider.out', { type: 'session.update', session: { instructions: '静默调用，直接说结果。', voice: 'v' } });
  f.journal.input(input, { turn: 0 }); f.journal.input(input, { turn: 1 });
  f.journal.record('provider.in', { type: 'response.audio.delta', response_id: 'r', item_id: 'i', delta: output.toString('base64') });
  f.journal.record('browser.out', { type: 'audio', responseId: 'r', audio: output.toString('base64') });
  f.journal.record('provider.in', { type: 'error', error: { message: 'private-test-secret and Bearer xyz', api_key: 'other-secret' } });
  const done = f.journal.close('hangup'); assert.equal(f.journal.close(), done); await done;
  assert.deepEqual(f.errors, []);
  const rows = await f.rows();
  assert.ok(rows.every((row, i) => row.seq === i + 1 && row.callId === f.journal.id));
  assert.ok(rows.every((row, i) => !i || row.elapsedMs >= rows[i - 1].elapsedMs));
  assert.equal(rows.at(-1).event.type, 'call.closed');
  assert.deepEqual(rows.filter(r => r.event.type === 'capture.packet').map(r => r.event.audio.offsetBytes), [0, 4]);
  assert.equal(rows.find(r => r.event.type === 'response.audio.delta').event.delta, undefined);
  const text = (await f.read('events.jsonl')).toString();
  assert.doesNotMatch(text, /private-test-secret|other-secret|Bearer xyz|BQYHCAkK/);
  assert.match(text, /REDACTED/);
  for (const [name, pcm, rate] of [['input.wav', Buffer.concat([input, input]), 16000], ['model-output.wav', output, 24000]]) {
    const wav = await f.read(name);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF'); assert.equal(wav.readUInt32LE(24), rate);
    assert.equal(wav.readUInt32LE(40), pcm.length); assert.deepEqual(wav.subarray(44), pcm);
    assert.equal((await stat(resolve(f.journal.directory, name))).mode & 0o777, 0o600);
  }
  const summary = JSON.parse(await f.read('summary.json'));
  assert.equal(summary.complete, true); assert.equal(summary.reason, 'hangup'); assert.deepEqual(summary.chunks, { input: 2, output: 1 });
  const handler = createHandler();
  assert.equal((await handler(new Request('http://localhost/logs/calls/any/events.jsonl'))).status, 404);
});

class Socket extends EventEmitter {
  readyState = 1; bufferedAmount = 0; sent = [];
  send(data) { this.sent.push(JSON.parse(data)); }
  receive(event) { this.emit('message', Buffer.from(JSON.stringify(event)), false); }
  terminate() { this.readyState = 3; this.emit('close'); }
  close() { this.terminate(); }
}

test('real bridge journals suppressed model output, tool execution, client playout and hangup without leaking credentials', async t => {
  const f = await fixture(t), client = new Socket(), upstream = new Socket();
  const bridge = createRealtimeBridge({ client, journal: f.journal,
    provider: { apiKey: 'private-test-secret', baseUrl: 'wss://example.test', model: 'test', voice: 'v' },
    validateUrl: async u => new URL(u), connect: () => upstream });
  t.after(() => bridge.close()); client.receive({ type: 'start', context: {} }); await new Promise(resolve => setImmediate(resolve));
  upstream.receive({ type: 'session.created' }); upstream.receive({ type: 'session.updated' });
  assert.equal(client.sent.at(-1).callId, f.journal.id); assert.equal(client.sent.at(-1).logging, true);
  client.emit('message', Buffer.alloc(640), true);
  upstream.receive({ type: 'input_audio_buffer.speech_started', item_id: 'u' });
  upstream.receive({ type: 'input_audio_buffer.speech_stopped', item_id: 'u' });
  upstream.receive({ type: 'response.created', response: { id: 'tool' } });
  upstream.receive({ type: 'response.output_item.added', response_id: 'tool', item: { type: 'function_call' } });
  upstream.receive({ type: 'response.audio.delta', response_id: 'tool', item_id: 'internal', delta: Buffer.alloc(4800).toString('base64') });
  upstream.receive({ type: 'response.audio_transcript.done', response_id: 'tool', item_id: 'internal', transcript: '我在调用工具。' });
  upstream.receive({ type: 'response.function_call_arguments.done', response_id: 'tool', call_id: 'lookup', name: 'search_knowledge_base', arguments: '{"query":"世界之窗 铁塔"}' });
  upstream.receive({ type: 'response.done', response: { id: 'tool', status: 'completed' } });
  assert.ok(!client.sent.some(e => e.type === 'audio' || e.type === 'answer'));
  client.receive({ type: 'diagnostic', name: 'vad_started', clientMs: 800, details: { boundaryClientMs: 700, boundarySample: 11200, inputSamples: 12800 } });
  client.receive({ type: 'diagnostic', name: 'playback_stopped', clientMs: 802, details: { responseId: 'old', reason: 'local-vad', hadPlayer: true, playedMs: 500, inputSamples: 12800 } });
  client.receive({ type: 'hangup' }); await f.journal.close();
  const rows = await f.rows(), summary = JSON.parse(await f.read('summary.json'));
  assert.ok(rows.some(r => r.event.type === 'tool_start'));
  assert.ok(rows.some(r => r.event.type === 'tool_end' && r.event.trace.result.results.length));
  assert.ok(rows.some(r => r.event.type === 'response.event_dropped' && r.event.reason === 'internal-tool-phase'));
  assert.equal(summary.bytes.input, 640); assert.equal(summary.bytes.output, 4800); assert.equal(summary.reason, 'hangup');
  const report = summarizeCall(rows, summary);
  assert.equal(report.interruptions[0].detectionToStopMs, 2); assert.equal(report.interruptions[0].vadEstimatedOnsetToStopMs, 102);
  assert.equal(report.answers[0].text, '我在调用工具。'); assert.equal(report.answers[0].playbackStarted, false);
  assert.deepEqual(report.suspectedSpokenToolText, []);
});

test('invalid browser diagnostics cannot inject arbitrary nested events into a journal', async t => {
  const f = await fixture(t), client = new Socket();
  const bridge = createRealtimeBridge({ client, journal: f.journal, provider: { apiKey: '', baseUrl: '', model: '', voice: '' } });
  client.receive({ type: 'diagnostic', name: 'playback_started', clientMs: -1, details: { forged: { data: 'nested' } } });
  await f.journal.close();
  assert.equal(client.sent.at(-1).code, 'invalid-request');
  assert.ok(!(await f.rows()).some(r => r.event.type === 'diagnostic')); bridge.close();
});

test('inspector matches speech to its turn when local VAD misses a short utterance and playback callbacks arrive late', () => {
  const rows = [];
  const diagnostic = (name, clientMs, details) => rows.push({ source: 'browser.in', context: {}, event: { type: 'diagnostic', name, clientMs, details } });
  for (const [turn, from, to] of [[1, 100, 300], [2, 1000, 1200], [3, 2000, 2200], [4, 3000, 3200]]) {
    rows.push({ source: 'provider.in', context: { turn }, event: { type: 'input_audio_buffer.speech_started', item_id: `u${turn}`, audio_start_ms: from } });
    rows.push({ source: 'provider.in', context: { turn }, event: { type: 'input_audio_buffer.speech_stopped', item_id: `u${turn}`, audio_end_ms: to } });
    rows.push({ source: 'browser.out', context: { turn }, event: { type: 'response_started', responseId: `r${turn}`, turn } });
    diagnostic('cloud_speech_started', from + 150, { turn });
    diagnostic('cloud_speech_stopped', to + 200, { turn });
    if (turn !== 2) {
      diagnostic('vad_started', from + 100, { turn: turn - 1, boundarySample: from * 16, boundaryClientMs: from });
      diagnostic('vad_stopped', to + 100, { turn, boundarySample: to * 16, boundaryClientMs: to });
    }
    diagnostic('playback_chunk', to + 400, { turn, responseId: `r${turn}`, startTimeMs: to + 450, audioTimeMs: to + 400 });
    diagnostic('playback_started', turn === 3 ? 3700 : to + 480, { turn: turn === 3 ? 4 : turn, responseId: `r${turn}` });
  }
  const replies = summarizeCall(rows).replies;
  assert.equal(replies[0].estimatedSpeechEndToScheduledPlaybackMs, 450);
  assert.equal(replies[1].speechBoundarySource, 'unavailable');
  assert.equal(replies[1].estimatedSpeechEndToScheduledPlaybackMs, null);
  assert.equal(replies[1].observedSpeechEndToPlaybackCallbackMs, null);
  assert.equal(replies[1].cloudEndToScheduledPlaybackMs, 250);
  assert.equal(replies[2].turn, 3);
  assert.equal(replies[2].estimatedSpeechEndToScheduledPlaybackMs, 450);
  assert.equal(replies[2].observedSpeechEndToPlaybackCallbackMs, 1500);
  assert.equal(replies[2].playbackCallbackLagMs, 1050);
});

test('inspector does not attribute a cloud interruption to a later local detection', () => {
  const rows = [
    { type: 'diagnostic', name: 'playback_stopped', clientMs: 1000, details: { responseId: 'old', reason: 'cloud-vad', hadPlayer: true } },
    { type: 'diagnostic', name: 'vad_started', clientMs: 1050, details: { boundaryClientMs: 954 } },
  ].map(event => ({ source: 'browser.in', event }));
  const interruption = summarizeCall(rows).interruptions[0];
  assert.equal(interruption.detectionToStopMs, null);
  assert.equal(interruption.vadEstimatedOnsetToStopMs, null);
});

test('call inspector wakes on the next finalized call without polling', { timeout: 10000 }, async t => {
  await mkdir('agent-tmp', { recursive: true });
  const root = await mkdtemp(resolve('agent-tmp/call-watch-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const child = spawn(process.execPath, ['scripts/inspect-call.mjs', '--wait'], { env: { ...process.env, CALL_LOG_DIR: root }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let output = '', error = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { error += chunk; });
  const exited = once(child, 'exit');
  await once(child.stdout, 'data'); assert.match(output, /Waiting for the next real call/);
  const journal = createCallJournal({ root, model: 'fixture', voice: 'fixture' });
  journal.input(Buffer.alloc(640)); await journal.close('hangup');
  assert.equal((await exited)[0], 0, error);
  assert.ok(output.includes(journal.id)); assert.match(output, /closed-and-saved/);
});
