import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/app.ts';
import { runTts, narrationSegments } from '../server/ai/tts.ts';
import { createAliyunSpeechService } from '../src/services/aliyun-speech.js';
import { createNativeVoiceService } from '../src/services/native-voice.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const pcm = Buffer.alloc(4800).toString('base64');
const provider = { baseUrl: 'https://8.8.8.8/tts', model: 'qwen3-tts-flash', voice: 'Cherry', apiKey: 'private-key' };
const sse = events => new Response(events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
const ndjson = events => new Response(events.map(event => JSON.stringify(event)).join('\n'), { headers: { 'Content-Type': 'application/x-ndjson' } });
const audioEvent = (charIndex = 0) => ({ type: 'audio_delta', audio: pcm, sampleRate: 24000, charIndex });

test('narration segmentation preserves text, Unicode and caption offsets within Qwen limits', () => {
  const text = `你好。${'🌲'.repeat(601)}！再见\n下一句？`;
  const segments = narrationSegments(text);
  assert.equal(segments.map(part => part.text).join(''), text);
  let offset = 0;
  for (const part of segments) {
    assert.equal(part.charIndex, offset); assert.ok([...part.text].length <= 600);
    offset += part.text.length;
  }
  assert.deepEqual(narrationSegments('第一句。第二句！').map(part => part.charIndex), [0, 4]);
});

test('Aliyun adapter sends exact text/voice and forwards only PCM, handling split UTF-8 SSE', async () => {
  const events = [], inputs = [];
  await runTts({ text: '第一句。第二句！', provider, signal: AbortSignal.timeout(5000), onEvent: event => events.push(event),
    fetchImpl: async (url, options) => {
      assert.equal(url, provider.baseUrl); assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer private-key');
      assert.equal(options.headers['X-DashScope-SSE'], 'enable');
      inputs.push(JSON.parse(options.body));
      const raw = new TextEncoder().encode(`: heartbeat\r\n\r\ndata: ${JSON.stringify({ output: { audio: { data: pcm }, text: '中文' } })}\r\n\r\ndata: ${JSON.stringify({ output: { finish_reason: 'stop', audio: { url: 'https://private-signed-url' } } })}\r\n\r\n`);
      return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < raw.length; i += 7) controller.enqueue(raw.slice(i, i + 7)); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
    } });
  assert.deepEqual(inputs.map(body => body.input.text), ['第一句。', '第二句！']);
  assert.equal(inputs[0].model, provider.model); assert.equal(inputs[0].input.voice, 'Cherry');
  assert.equal(inputs[0].input.language_type, 'Chinese');
  assert.deepEqual(events.map(event => event.charIndex), [0, 4]);
  assert.doesNotMatch(JSON.stringify(events), /private-key|private-signed-url/);
});

test('Aliyun rejects errors, incomplete streams, empty audio and malformed PCM', async () => {
  for (const response of [new Response('secret', { status: 401 }), new Response('{}'),
    sse([{ code: 'secret-error', message: 'private-key' }]),
    sse([{ output: { audio: { data: pcm } } }]),
    sse([{ output: { finish_reason: 'stop' } }]),
    sse([{ output: { audio: { data: 'AA==' }, finish_reason: 'stop' } }]),
    sse([{ output: { audio: { data: 'invalid!' }, finish_reason: 'stop' } }])]) {
    await assert.rejects(runTts({ text: '你好', provider, signal: AbortSignal.timeout(5000), onEvent() {}, fetchImpl: async () => response }));
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runTts({ text: '你好', provider, signal: controller.signal, onEvent() {}, fetchImpl: () => assert.fail('aborted synthesis reached upstream') }));
});

test('TTS API requires configuration, same-origin JSON and bounded plain text', async t => {
  const app = createApp({ env: {}, ttsAgent: () => assert.fail('invalid request reached TTS') }); t.after(() => app.close());
  const post = (payload, headers) => app.inject({ method: 'POST', url: '/api/tts', payload, headers });
  assert.equal((await post({ text: '你好' })).statusCode, 503);
  assert.equal((await app.inject('/api/status')).json().localNarrationTts, 'unavailable');
  for (const payload of [{}, { text: '' }, { text: ' ' }, { text: 1 }, { text: '字'.repeat(4001) }, { text: '你好', voice: 'forged' }]) assert.equal((await post(payload)).statusCode, 400);
  assert.equal((await post('你好', { 'content-type': 'text/plain' })).statusCode, 415);
  assert.equal((await post({ text: '你好' }, { origin: 'https://evil.example' })).statusCode, 403);
  assert.equal((await app.inject('/api/tts')).statusCode, 405);
});

test('TTS API streams audio and completion without keys; failures and deadlines stay safe', async t => {
  let calls = 0, timedOut;
  const app = createApp({ env: { DASHSCOPE_API_KEY: 'private-key' }, ttsTimeoutMs: 20, ttsAgent: async options => {
    assert.equal(options.provider.apiKey, 'private-key');
    if (calls++ === 0) { options.onEvent(audioEvent()); return; }
    if (calls === 2) throw new Error('private-key');
    timedOut = options.signal; return new Promise(() => {});
  } }); t.after(() => app.close());
  const post = () => app.inject({ method: 'POST', url: '/api/tts', payload: { text: '你好' } });
  const first = await post();
  assert.equal(first.statusCode, 200);
  const events = first.body.trim().split('\n').map(JSON.parse);
  assert.equal(events[0].audio, pcm); assert.equal(events.at(-1).content, '你好');
  const status = await app.inject('/api/status');
  assert.equal(status.json().localNarrationTts, 'aliyun'); assert.equal(status.json().narrationVoice.voice, 'Cherry');
  assert.doesNotMatch(status.body + first.body, /private-key/);
  for (let i = 0; i < 2; i++) {
    const response = await post(); assert.match(response.body, /TTS_UNAVAILABLE/); assert.doesNotMatch(response.body, /private-key/);
  }
  assert.equal(timedOut.aborted, true);
});

test('real HTTP TTS streams early, shares concurrency and aborts upstream on disconnect/shutdown', async t => {
  const signals = [];
  const app = createApp({ env: { DASHSCOPE_API_KEY: 'private-key', CHAT_API_KEY: 'private-chat' }, ttsAgent: async options => {
    signals.push(options.signal); options.onEvent(audioEvent());
    if (options.text === '重试') return;
    await new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
  } }); t.after(() => app.close());
  await app.listen({ host: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = (path, text) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(5000) });
  const responses = [];
  for (let i = 0; i < 3; i++) responses.push(await post('/api/tts', '你好'));
  const reader = responses[0].body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /audio_delta/); assert.doesNotMatch(first, /answer/);
  const busy = await post('/api/guide', '你好'); assert.equal(busy.status, 429); await busy.body.cancel();
  const aborted = once(signals[0], 'abort', { signal: AbortSignal.timeout(5000) });
  await reader.cancel(); await aborted; await tick();
  const retry = await post('/api/tts', '重试'); assert.equal(retry.status, 200); assert.match(await retry.text(), /answer/);
  await app.close(); assert.ok(signals.every(signal => signal.aborted || signal === signals.at(-1)));
  for (const response of responses.slice(1)) await response.body.cancel().catch(() => {});
});

function playbackFixture(fetchImpl) {
  const nodes = [], timers = new Map(); let id = 0;
  const context = { state: 'running', currentTime: 0, destination: {}, async resume() {}, async close() {},
    createBuffer(channels, length, rate) { return { duration: length / rate, getChannelData: () => new Float32Array(length) }; },
    createBufferSource() { const node = { connect() {}, disconnect() {}, start(time) { this.time = time; }, stop() { this.stopped = true; } }; nodes.push(node); return node; } };
  const scope = { AudioContext: class { constructor() { return context; } }, atob, fetch: fetchImpl,
    setTimeout(callback, ms) { timers.set(++id, { callback, ms }); return id; }, clearTimeout(key) { timers.delete(key); },
    speechSynthesis: { speak() { assert.fail('browser voice fallback must never run'); } } };
  const fire = () => { const due = [...timers].filter(([, timer]) => timer.ms < 1000); for (const [key, timer] of due) if (timers.delete(key)) timer.callback(); };
  return { service: createAliyunSpeechService(scope), context, nodes, timers, fire };
}

test('cloud narration drives mouth and sentence cues on playback time, not receipt time', async () => {
  const f = playbackFixture(async (url, options) => {
    assert.equal(url, '/api/tts'); assert.equal(JSON.parse(options.body).text, '你好。再见。');
    return ndjson([audioEvent(), audioEvent(3), { type: 'answer', content: '你好。再见。' }]);
  });
  let starts = 0, settled = false; const boundaries = [];
  const pending = f.service.speak('你好。再见。', { onStart() { starts++; }, onBoundary(index) { boundaries.push(index); } }); pending.then(() => { settled = true; });
  await tick();
  assert.equal(f.nodes.length, 2); assert.equal(starts, 0); assert.deepEqual(boundaries, []);
  f.context.currentTime = .04; f.fire();
  assert.equal(starts, 1); assert.deepEqual(boundaries, [0]);
  assert.equal(settled, false);
  f.context.currentTime = .14; f.fire(); assert.deepEqual(boundaries, [0, 3]);
  f.nodes[0].onended(); await tick(); assert.equal(settled, false);
  f.nodes[1].onended(); assert.equal((await pending).status, 'success'); assert.equal(f.timers.size, 0);
});

test('stop cancels pending fetch immediately and late audio cannot revive playback', async () => {
  let respond, signal;
  const f = playbackFixture((_url, options) => { signal = options.signal; return new Promise(resolve => { respond = resolve; }); });
  let starts = 0;
  const pending = f.service.speak('你好', { onStart() { starts++; } }); await tick();
  f.service.stopSpeaking();
  assert.equal((await pending).status, 'cancelled'); assert.equal(signal.aborted, true);
  respond(ndjson([audioEvent(), { type: 'answer', content: '你好' }])); await tick();
  assert.equal(f.nodes.length, 0); assert.equal(starts, 0); assert.equal(f.timers.size, 0);
});

test('interrupting queued audio stops sources and suppresses late sentence cues', async () => {
  const f = playbackFixture(async () => ndjson([audioEvent(), { type: 'answer', content: '你好' }]));
  let cues = 0;
  const pending = f.service.speak('你好', { onStart() { cues++; }, onBoundary() { cues++; } }); await tick();
  const late = [...f.timers.values()].filter(timer => timer.ms < 1000).map(timer => timer.callback);
  f.service.stopSpeaking(); assert.equal((await pending).status, 'cancelled');
  assert.equal(f.nodes[0].stopped, true); f.context.currentTime = 2; for (const callback of late) callback();
  assert.equal(cues, 0); assert.equal(f.timers.size, 0);
});

test('cloud failure preserves explicit failure without browser fallback; timeout clears pending work', async () => {
  for (const response of [new Response('{}', { status: 503 }), ndjson([{ type: 'error' }]), ndjson([{ type: 'answer', content: '你好' }])]) {
    const f = playbackFixture(async () => response);
    assert.equal((await f.service.speak('你好')).status, 'error'); assert.equal(f.timers.size, 0);
  }
  const f = playbackFixture(() => new Promise(() => {}));
  const pending = f.service.speak('你好'); await tick();
  const [key, timer] = [...f.timers].find(([, timer]) => timer.ms === 180000);
  f.timers.delete(key); timer.callback();
  assert.equal((await pending).error, 'timeout'); assert.equal(f.timers.size, 0);
});

test('noncached narration stops old native audio before starting cloud synthesis', async () => {
  let stops = 0, spoken = 0;
  const service = createNativeVoiceService({ browserSpeech: { stopSpeaking() { stops++; }, stopRecognition() {}, speak(text) { spoken++; return { status: 'success' }; } } });
  assert.equal((await service.speak('固定文本')).status, 'success');
  assert.ok(stops > 0); assert.equal(spoken, 1); service.dispose();
});

test('blocked AudioContext unlock fails promptly and stopping while suspended clears all timers', async () => {
  const f = playbackFixture(() => assert.fail('blocked playback must not consume paid TTS'));
  f.context.state = 'suspended'; f.context.resume = () => new Promise(() => {});
  const pending = f.service.speak('你好');
  const [key, timer] = [...f.timers].find(([, timer]) => timer.ms === 1500);
  f.timers.delete(key); timer.callback();
  assert.equal((await pending).error, 'audio-playback-blocked'); assert.equal(f.timers.size, 0);
  const next = f.service.speak('再见'); f.service.stopSpeaking();
  assert.equal((await next).status, 'cancelled'); assert.equal(f.timers.size, 0);
});
