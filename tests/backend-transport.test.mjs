import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { createApp } from '../server/app.ts';
import { runVoice } from '../server/ai/voice.ts';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const bounded = async promise => {
  let timer;
  try { return await Promise.race([promise, new Promise((_r, reject) => { timer = setTimeout(() => reject(new Error('Timed out waiting for transport')), 5000); })]); }
  finally { clearTimeout(timer); }
};
const audio = Buffer.alloc(6400).toString('base64');

test('real HTTP + local supplier WebSocket streams before completion and client abort closes upstream', async t => {
  const upstream = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(upstream, 'listening');
  let release, receivedBytes = 0, hang = false;
  const responding = deferred();
  upstream.on('connection', (socket, request) => {
    assert.equal(request.headers.authorization, 'Bearer private-native-key');
    const emit = (type, data = {}) => socket.send(JSON.stringify({ type, ...data }));
    socket.on('message', raw => {
      const event = JSON.parse(raw);
      if (event.type === 'session.update') emit('session.updated');
      if (event.type === 'input_audio_buffer.append') receivedBytes += Buffer.from(event.audio, 'base64').length;
      if (event.type === 'input_audio_buffer.commit') emit('input_audio_buffer.committed');
      if (event.type === 'response.create' && !hang) {
        emit('response.created', { response: { id: 'response-real' } });
        emit('response.audio.delta', { delta: Buffer.alloc(4800).toString('base64') });
        release = () => { emit('response.audio_transcript.done', { transcript: '你好深圳。' }); emit('response.done', { response: { status: 'completed' } }); };
        responding.resolve();
      }
    });
    emit('session.created');
  });
  const app = createApp({ env: { DASHSCOPE_API_KEY: 'private-native-key' }, voiceAgent: options => runVoice({ ...options, validateUrl: async () => new URL(`ws://127.0.0.1:${upstream.address().port}`) }) });
  t.after(async () => {
    for (const client of upstream.clients) client.terminate();
    await Promise.all([app.close(), new Promise(resolve => upstream.close(resolve))]);
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${app.server.address().port}/api/voice`;
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audio }) };
  const response = await fetch(url, options);
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /ndjson/);
  const reader = response.body.getReader();
  let raw = new TextDecoder().decode((await bounded(reader.read())).value);
  assert.match(raw, /"type":"status"/);
  assert.doesNotMatch(raw, /"type":"answer"/);
  await bounded(responding.promise); release();
  while (true) { const result = await bounded(reader.read()); if (result.done) break; raw += new TextDecoder().decode(result.value); }
  const events = raw.trim().split('\n').map(JSON.parse);
  assert.equal(events.at(-1).content, '你好深圳。');
  assert.ok(events.some(e => e.type === 'audio_delta')); assert.equal(receivedBytes, 6400);
  hang = true;
  const connected = deferred(), closed = deferred();
  upstream.once('connection', socket => { socket.once('close', () => closed.resolve()); connected.resolve(); });
  const controller = new AbortController();
  const pending = await fetch(url, { ...options, signal: controller.signal });
  await bounded(connected.promise); controller.abort();
  await pending.body.cancel().catch(() => {});
  await bounded(closed.promise);
});

test('text and voice share three concurrency slots and a disconnected text client cancels its model task', async t => {
  const started = deferred(), cancelled = deferred();
  let count = 0;
  const app = createApp({ env: { DEEPSEEK_API_KEY: 'test', DASHSCOPE_API_KEY: 'test' }, agent: options => new Promise((_resolve, reject) => {
    if (++count === 3) started.resolve();
    options.signal.addEventListener('abort', () => { cancelled.resolve(); reject(new Error('cancelled')); }, { once: true });
  }) });
  t.after(() => app.close());
  await app.listen({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const controllers = Array.from({ length: 3 }, () => new AbortController());
  const requests = controllers.map(controller => fetch(base + '/api/guide', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '等待' }) }).catch(error => error));
  try {
    await bounded(started.promise);
    const rejected = await fetch(base + '/api/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audio }) });
    assert.equal(rejected.status, 429); await rejected.body.cancel();
    controllers[0].abort(); await bounded(cancelled.promise);
  } finally {
    for (const controller of controllers) controller.abort();
    await Promise.all(requests);
  }
});
