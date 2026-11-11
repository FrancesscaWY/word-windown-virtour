import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePcm, consumeVoiceStream, createPcmPlayback } from '../src/services/native-audio.js';
import { createNativeVoiceService } from '../src/services/native-voice.js';
import { createGuideController } from '../src/guide/controller.js';
import { createVoiceSession } from '../src/guide/voice-session.js';
import { createStore } from '../src/guide/store.js';
import { createTourActions } from '../src/guide/tour-actions.js';
import { createHandler } from '../server/handler.mjs';
import { microphoneHelp } from '../src/components/microphone-help.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const stream = events => new Response(events.map(event => JSON.stringify(event)).join('\n'), { headers: { 'Content-Type': 'application/x-ndjson' } });
const validAudio = Buffer.alloc(6400).toString('base64');
function fixture(respond) {
  const store = createStore();
  let stops = 0;
  const speech = { stop() { stops++; }, stopSpeaking() {}, respondToAudio: respond,
    speak() { assert.fail('native answer called browser TTS'); } };
  const guide = createGuideController({ store, actions: createTourActions(store), speech });
  return { store, speech, guide, stops: () => stops };
}

test('microphone PCM encoding uses mono signed 16-bit little endian and resamples to 16kHz', () => {
  const bytes = Buffer.from(encodePcm(new Float32Array([-1, -.5, 0, .5, 1]), 16000), 'base64');
  assert.deepEqual([...new Int16Array(bytes.buffer, bytes.byteOffset, 5)], [-32768, -16384, 0, 16384, 32767]);
  assert.equal(Buffer.from(encodePcm(new Float32Array(48000), 48000), 'base64').length, 32000);
});

test('voice decoder forwards transcript/audio events across UTF-8 splits and requires a final answer', async () => {
  const raw = new TextEncoder().encode(JSON.stringify({ type: 'input_transcript', transcript: '你好深圳' }) + '\n' + JSON.stringify({ type: 'audio_delta', audio: validAudio }) + '\n' + JSON.stringify({ type: 'answer', content: '语音字幕' }));
  const events = [];
  const body = new ReadableStream({ start(controller) { for (let i = 0; i < raw.length; i += 3) controller.enqueue(raw.slice(i, i + 3)); controller.close(); } });
  const result = await consumeVoiceStream(new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } }), event => events.push(event));
  assert.equal(result.content, '语音字幕'); assert.equal(events[0].transcript, '你好深圳'); assert.equal(events[1].audio, validAudio);
  await assert.rejects(() => consumeVoiceStream(stream([{ type: 'audio_delta', audio: validAudio }]), () => {}), /完整/);
  await assert.rejects(() => consumeVoiceStream(stream([{ type: 'error', error: 'secret' }]), () => {}), /后端未能/);
});

test('PCM output is queued at 24kHz and finishes after the last actual source ends', async () => {
  const nodes = [], timers = [];
  const context = { state: 'running', currentTime: 1, destination: {},
    createBuffer(channels, length, rate) { assert.equal(channels, 1); assert.equal(rate, 24000); return { duration: length / rate, getChannelData: () => new Float32Array(length) }; },
    createBufferSource() { const node = { connect() {}, disconnect() {}, start(time) { this.time = time; }, stop() { this.stopped = true; } }; nodes.push(node); return node; } };
  let starts = 0, ended = false;
  const player = createPcmPlayback(context, { scope: { atob, setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {} }, onStart() { starts++; } });
  player.append(validAudio); player.append(validAudio); player.seal(); player.done.then(() => { ended = true; });
  await tick(); assert.equal(ended, false); assert.ok(nodes[1].time > nodes[0].time);
  context.currentTime = 2; timers.shift()(); assert.equal(starts, 1);
  nodes[0].onended(); await tick(); assert.equal(ended, false);
  nodes[1].onended(); assert.equal((await player.done).status, 'success');
  const next = createPcmPlayback(context); next.append(validAudio); next.stop();
  assert.equal((await next.done).status, 'cancelled'); assert.equal(nodes.at(-1).stopped, true);
});

test('voice proxy streams events before upstream completion, validates PCM, and carries cancellation', async () => {
  let end, captured;
  const controller = new AbortController();
  const handle = createHandler({ env: { GUIDE_BACKEND_URL: 'https://voice.example/' }, fetchImpl: async (url, options) => {
    assert.equal(url.href, 'https://voice.example/api/voice'); captured = options;
    assert.equal(JSON.parse(options.body).city, '深圳');
    return new Response(new ReadableStream({ start(output) { output.enqueue(new TextEncoder().encode('{"type":"status"}\n')); end = () => output.close(); } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
  } });
  const response = await handle(new Request('http://localhost/api/voice', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audio: validAudio }) }));
  const reader = response.body.getReader(); assert.match(new TextDecoder().decode((await reader.read()).value), /status/);
  controller.abort(); assert.equal(captured.signal.aborted, true); end(); await reader.cancel();
  for (const audio of ['invalid!', '', Buffer.alloc(2).toString('base64')]) {
    assert.equal((await handle(new Request('http://localhost/api/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audio }) }))).status, 400);
  }
});

test('native transcripts update the conversation and map while native playback drives speaking', async () => {
  const f = fixture(async (audio, context, events) => {
    assert.equal(audio, validAudio);
    events.onTranscript('带我看铁塔');
    assert.equal(f.store.get().view, 'panorama'); assert.equal(f.store.get().guideStatus, 'thinking');
    events.onStart(); assert.equal(f.store.get().guideStatus, 'speaking');
    events.onAnswer({ content: '这是后端生成的讲解。', model: 'qwen-audio' });
    assert.equal(f.store.get().guideStatus, 'speaking');
    return { status: 'success' };
  });
  assert.equal((await f.guide.submitAudio(validAudio)).status, 'executed');
  assert.equal(f.store.get().messages[0].text, '带我看铁塔');
  assert.equal(f.store.get().guideText, '这是后端生成的讲解。'); assert.equal(f.store.get().guideStatus, 'idle');
  assert.equal(f.store.get().pendingNarration, null);
});

test('native stop transcript cancels upstream and explicit interruption suppresses late events', async () => {
  const f = fixture(async (audio, context, events) => {
    events.onTranscript('停止'); assert.equal(events.signal.aborted, true); return { status: 'cancelled' };
  });
  assert.equal((await f.guide.submitAudio(validAudio)).intent, 'stop');
  let events, settle;
  const another = fixture((audio, context, options) => { events = options; return new Promise(resolve => { settle = resolve; }); });
  const pending = another.guide.submitAudio(validAudio);
  another.guide.interrupt(); assert.equal(events.signal.aborted, true);
  events.onAnswer({ content: 'stale native answer' }); events.onStart(); settle({ status: 'success' });
  assert.equal((await pending).status, 'cancelled'); assert.equal(another.store.get().guideStatus, 'idle');
  assert.ok(!another.store.get().messages.some(row => row.text === 'stale native answer'));
});

test('voice stream failure preserves available subtitles and displays a truthful playback error', async () => {
  const f = fixture(async (audio, context, events) => { events.onAnswer({ content: '已收到的字幕' }); throw new Error('语音连接中断'); });
  assert.equal((await f.guide.submitAudio(validAudio)).status, 'error');
  assert.equal(f.store.get().guideText, '已收到的字幕'); assert.equal(f.store.get().guideStatus, 'idle'); assert.match(f.store.get().guideError, /连接中断/);
});

test('voice session accepts native PCM without browser SpeechRecognition', async () => {
  const store = createStore(); let submitted = 0;
  const guide = { interrupt() {}, async submitAudio(audio) { assert.equal(audio, validAudio); submitted++; return { intent: 'stop' }; } };
  const speech = { supportsRecognition: () => true, stopRecognition() {}, async recognizeOnce(onInterim, events) { events.onStart(); return { status: 'success', audio: validAudio }; } };
  const session = createVoiceSession({ store, guide, speech, scope: { isSecureContext: true }, schedule() { return 1; }, unschedule() {} });
  assert.equal(session.start(), true); await tick();
  assert.equal(submitted, 1); assert.equal(session.active, false); session.dispose();
});

test('native capability help works without Web Speech and requires only recording/playback APIs', () => {
  const help = microphoneHelp({ voiceProvider: 'backend-native', voiceErrorCode: 'permission-required' }, { isSecureContext: true, AudioContext: class {}, navigator: { mediaDevices: { getUserMedia() {} } }, location: { protocol: 'http:', origin: 'http://localhost' } });
  assert.equal(help.canRequest, true); assert.match(help.checks[1][1], /Qwen/);
});

test('native microphone automatically submits voiced PCM after silence and releases its hardware', async () => {
  let processor, released = 0, captures = 0;
  const timers = new Map(); let timerId = 0;
  const scope = { isSecureContext: true, location: { protocol: 'http:' }, btoa, atob,
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); },
    navigator: { permissions: { query: async () => ({ state: 'granted' }) }, mediaDevices: { async getUserMedia() { captures++; return { getTracks: () => [{ stop() { released++; } }] }; } } },
    AudioContext: class { sampleRate = 48000; state = 'running'; destination = {}; async resume() {} async close() {} createMediaStreamSource() { return { connect() {}, disconnect() {} }; } createGain() { return { gain: {}, connect() {}, disconnect() {} }; } createScriptProcessor() { processor = { connect() {}, disconnect() {} }; return processor; } },
  };
  const browser = { stopRecognition() {}, stopSpeaking() {}, getMicrophoneDiagnostics: () => ({ permissionState: 'unknown' }) };
  const voice = createNativeVoiceService({ scope, browserSpeech: browser });
  let starts = 0;
  const pending = voice.recognizeOnce(() => {}, { onStart() { starts++; } });
  await tick(); assert.equal(starts, 0);
  const feed = value => processor.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(4096).fill(value) } });
  for (let i = 0; i < 3; i++) feed(.1);
  for (let i = 0; i < 13; i++) feed(0);
  const result = await pending; assert.equal(result.status, 'success'); assert.equal(starts, 1); assert.equal(captures, 1); assert.equal(released, 1);
  assert.ok(Buffer.from(result.audio, 'base64').length > 3200); assert.equal(processor.onaudioprocess, null);
  scope.navigator.permissions.query = async () => ({ state: 'prompt' });
  assert.equal((await voice.recognizeOnce()).error, 'permission-required'); assert.equal(captures, 1);
  voice.dispose();
});
