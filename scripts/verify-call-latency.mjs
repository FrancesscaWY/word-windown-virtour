import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createProxy } from '../server/proxy.ts';
import { createRealtimeBridge } from '../server/ai/realtime.ts';

// Real Chromium capture/worklet/Silero/playout; --live also uses the configured real Qwen.
// Inputs: 16-bit LE / mono / 16 kHz recorded speech, never synthesized detector events.
const live = process.argv.includes('--live');
const { chromium } = await import(pathToFileURL(process.env.VIRTOUR_PLAYWRIGHT_PATH ?? `${homedir()}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`).href);
const recordings = {};
for (const name of ['question', 'followup']) {
  const pcm = await readFile(process.env[`CALL_${name.toUpperCase()}_PCM`] ?? `agent-tmp/calls/${name}.pcm`);
  const samples = Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2) / 32768);
  const voiced = [];
  for (let i = 0; i + 160 <= samples.length; i += 160) {
    const rms = Math.sqrt(samples.slice(i, i + 160).reduce((sum, x) => sum + x * x, 0) / 160);
    if (rms >= .01) voiced.push(i / 16);
  }
  assert.ok(voiced.length, `${name}: speech recording required`);
  recordings[name] = { samples, onsetMs: voiced[0], endMs: voiced.at(-1) + 10 };
}
let model;
class ModelSocket extends EventEmitter {
  readyState = 1; bufferedAmount = 0; commands = [];
  receive(event) { this.emit('message', Buffer.from(JSON.stringify(event))); }
  send(raw) {
    const event = JSON.parse(raw); this.commands.push(event);
    if (event.type === 'session.update') queueMicrotask(() => this.receive({ type: 'session.updated' }));
  }
  terminate() { this.readyState = 3; this.emit('close'); }
}
const { proxy } = await createProxy(live ? { backendOptions: { env: { ...process.env, CALL_LOG_DIR: 'agent-tmp/calls/journal-live-verification' } } } : { backendOptions: { env: { DASHSCOPE_API_KEY: 'test-only', CALL_LOG_DIR: 'agent-tmp/calls/journal-latency-fixture' }, realtimeBridge: options =>
  createRealtimeBridge({ ...options, validateUrl: async url => new URL(url), connect: () => {
    model = new ModelSocket(); queueMicrotask(() => model.receive({ type: 'session.created' })); return model;
  } }),
} });
let browser;
const timers = [];
const tone = Buffer.alloc(48000 * 10);
for (let i = 0; i < tone.length / 2; i++) tone.writeInt16LE(Math.round(Math.sin(i / 24000 * Math.PI * 440) * 1200), i * 2);
const respond = id => {
  model.receive({ type: 'response.created', response: { id } });
  model.receive({ type: 'response.audio.delta', response_id: id, item_id: `item-${id}`, content_index: 0, delta: tone.toString('base64') });
};
try {
  const origin = await proxy.listen({ port: 0, host: '127.0.0.1' });
  browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    window.__sent = []; window.__received = []; window.__playout = [];
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      if (!this.__observed) { this.__observed = true; this.addEventListener('message', e => {
        const event = JSON.parse(e.data); if (event.type !== 'audio') window.__received.push({ ...event, at: performance.now() });
      }); }
      if (typeof data === 'string') window.__sent.push({ ...JSON.parse(data), at: performance.now() });
      return send.call(this, data);
    };
    const createSource = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = createSource.call(this), context = this, row = {};
      const start = source.start.bind(source), stop = source.stop.bind(source);
      source.start = (at = 0, ...args) => {
        if (source.buffer.sampleRate === 24000) { row.start = performance.now() + Math.max(0, at - context.currentTime) * 1000; window.__playout.push(row); }
        return start(at, ...args);
      };
      source.stop = (...args) => { row.stop = performance.now(); return stop(...args); };
      return source;
    };
    navigator.mediaDevices.getUserMedia = async () => {
      const context = window.__micContext = new AudioContext(); await context.resume();
      const destination = window.__micDestination = context.createMediaStreamDestination();
      return destination.stream;
    };
    window.__inject = ({ samples, onsetMs, endMs }) => {
      const context = window.__micContext;
      const buffer = context.createBuffer(1, samples.length, 16000); buffer.getChannelData(0).set(samples);
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(window.__micDestination);
      const at = context.currentTime + .1, wall = performance.now() + 100;
      source.start(at);
      window.__inputDone = new Promise(resolve => { source.onended = resolve; });
      return { onset: wall + onsetMs, end: wall + endMs, duration: buffer.duration };
    };
  });
  await page.goto(`${origin}/tour.html?mode=interactive`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => { window.__store = (await import('/src/guide/store.js')).store; });
  await page.locator('#live-call-button').click();
  await page.waitForFunction(() => window.__store.get().callState === 'connected');
  if (live) {
    await page.evaluate(recording => window.__inject(recording), recordings.question);
  } else {
    // Inject all real cue recordings into the mic at unity gain; they must not barge in.
    for (const name of ['dial', 'connected', 'ended']) await page.evaluate(async name => {
      const buffer = await window.__micContext.decodeAudioData(await (await fetch(`/assets/audio/call-${name}.wav`)).arrayBuffer());
      const source = window.__micContext.createBufferSource(); source.buffer = buffer; source.connect(window.__micDestination);
      await new Promise(resolve => { source.onended = resolve; source.start(); });
    }, name);
    assert.equal(await page.evaluate(() => window.__sent.filter(e => e.type === 'barge_in').length), 0, 'piano cues must not trigger speech');
    await page.locator('#call-mute').click();
    await page.evaluate(recording => window.__inject(recording), recordings.followup);
    await page.evaluate(() => window.__inputDone);
    assert.equal(await page.evaluate(() => window.__sent.filter(e => e.type === 'barge_in').length), 0, 'muted recording must not trigger speech');
    await page.locator('#call-mute').click();
    respond('old');
  }
  await page.waitForFunction(() => window.__playout.length > 0, null, { timeout: 60000 });
  const before = await page.evaluate(() => ({ sent: window.__sent.length, playout: window.__playout.length }));
  const input = await page.evaluate(recording => window.__inject(recording), recordings.followup);
  if (!live) {
    const now = await page.evaluate(() => performance.now());
    timers.push(setTimeout(() => model.receive({ type: 'input_audio_buffer.speech_started' }), input.onset + 1200 - now));
    timers.push(setTimeout(() => {
      model.receive({ type: 'input_audio_buffer.speech_stopped' }); respond('new');
    }, input.end + 450 - now));
  }
  await page.waitForFunction(index => window.__sent.slice(index).some(e => e.type === 'barge_in'), before.sent, { timeout: 15000 });
  const interruption = await page.evaluate(index => ({
    at: window.__sent.slice(index).find(e => e.type === 'barge_in').at,
    stopped: window.__playout.filter(e => e.stop).map(e => e.stop),
  }), before.sent);
  const localMs = interruption.at - input.onset;
  assert.ok(localMs >= 0 && localMs < 500, `local interruption ${localMs.toFixed(1)}ms`);
  assert.ok(interruption.stopped.some(at => Math.abs(at - interruption.at) < 20), 'playout stops in the local onset callback');
  if (!live) {
    assert.ok(model.commands.some(e => e.type === 'response.cancel'));
    const audioBefore = await page.evaluate(() => window.__playout.length);
    model.receive({ type: 'response.audio.delta', response_id: 'old', item_id: 'item-old', content_index: 0, delta: tone.toString('base64') });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => window.__playout.length), audioBefore, 'late old audio stays silent');
  }
  await page.waitForFunction(end => window.__playout.some(e => e.start > end), input.end, { timeout: 60000 });
  if (live) await page.waitForFunction(end => window.__received.some(e => e.type === 'response_done' && !e.continuing && e.at > end), input.end, { timeout: 60000 });
  const result = await page.evaluate(({ input, localMs, live }) => ({
    mode: live ? 'real-qwen' : 'delayed-cloud-fixture', localStopMs: Math.round(localMs),
    speechEndToNewAudioMs: Math.round(window.__playout.find(e => e.start > input.end).start - input.end),
    cloudOnsetMs: Math.round(window.__received.find(e => e.type === 'speech_started' && e.at >= input.onset).at - input.onset),
    transcripts: window.__received.filter(e => e.type === 'transcript').map(e => e.text),
    answer: window.__received.filter(e => e.type === 'answer' && e.at > input.end).at(-1)?.text,
    errors: window.__received.filter(e => e.type === 'error'),
  }), { input, localMs, live });
  assert.deepEqual(result.errors, []); assert.deepEqual(errors, []);
  if (!live) assert.ok(result.cloudOnsetMs >= 1150 && result.localStopMs < result.cloudOnsetMs - 600);
  await mkdir('agent-tmp/calls', { recursive: true });
  await writeFile(`agent-tmp/calls/latency-${live ? 'live' : 'fixture'}.json`, JSON.stringify(result, null, 2) + '\n');
  await page.screenshot({ path: `agent-tmp/calls/latency-${live ? 'live' : 'fixture'}.png` });
  await page.locator('#live-call-button').click();
  console.log(JSON.stringify(result, null, 2));
} finally { for (const timer of timers) clearTimeout(timer); await browser?.close(); await proxy.close(); }
