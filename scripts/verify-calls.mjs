import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createProxy } from '../server/proxy.ts';
import { createRealtimeBridge } from '../server/ai/realtime.ts';

// Isolated protocol fixture. Production always connects to the configured real model.
const { chromium } = await import(pathToFileURL(process.env.VIRTOUR_PLAYWRIGHT_PATH ?? `${homedir()}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`).href);
const upstreams = [];
class ModelSocket extends EventEmitter {
  readyState = 1; bufferedAmount = 0; packets = 0; commands = [];
  receive(event) { this.emit('message', Buffer.from(JSON.stringify(event))); }
  send(raw) {
    const event = JSON.parse(raw); this.commands.push(event);
    if (event.type === 'session.update') queueMicrotask(() => this.receive({ type: 'session.updated' }));
    if (event.type === 'input_audio_buffer.append') this.packets++;
  }
  terminate() { this.ended = true; this.readyState = 3; this.emit('close'); }
}
const { proxy } = await createProxy({ backendOptions: { env: { DASHSCOPE_API_KEY: 'test-only', CALL_LOG_DIR: 'agent-tmp/calls/journal-fixture' }, realtimeBridge: options =>
  createRealtimeBridge({ ...options, validateUrl: async url => new URL(url), connect: () => {
    const upstream = new ModelSocket(); upstreams.push(upstream);
    queueMicrotask(() => upstream.receive({ type: 'session.created' })); return upstream;
  } }),
} });
let browser;
const pcm = Buffer.alloc(48000);
for (let i = 0; i < 24000; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 24000 * Math.PI * 2 * 220) * 1500), i * 2);
try {
  const origin = await proxy.listen({ port: 0, host: '127.0.0.1' });
  browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), headless: true,
    args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--enable-unsafe-swiftshader'] });
  await mkdir('agent-tmp/calls', { recursive: true });
  for (const [label, viewport] of [['mobile', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]]) {
    const page = await browser.newPage({ viewport }); const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.__streams = []; window.__audio = [];
      const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async options => { const stream = await getUserMedia(options); window.__streams.push(stream); return stream; };
      const createSource = AudioContext.prototype.createBufferSource;
      AudioContext.prototype.createBufferSource = function () {
        const source = createSource.call(this), row = { source, stopped: false, ended: false }; window.__audio.push(row);
        source.addEventListener('ended', () => { row.ended = true; });
        const stop = source.stop.bind(source); source.stop = (...args) => { row.stopped = true; return stop(...args); }; return source;
      };
    });
    await page.goto(`${origin}/tour.html?mode=interactive`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => { window.__store = (await import('/src/guide/store.js')).store; });
    await page.locator('#live-call-button').click();
    await page.waitForFunction(() => window.__store.get().callState === 'connected');
    const model = upstreams.at(-1);
    await page.waitForFunction(() => window.__streams.length === 1 && window.__streams[0].getAudioTracks()[0].readyState === 'live');
    model.receive({ type: 'input_audio_buffer.speech_started' }); model.receive({ type: 'input_audio_buffer.speech_stopped' });
    model.receive({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'user-1', transcript: '介绍一下铁塔' });
    model.receive({ type: 'response.created', response: { id: 'response-1' } });
    model.receive({ type: 'response.audio_transcript.done', response_id: 'response-1', item_id: 'answer-1', transcript: '园里的铁塔是巴黎埃菲尔铁塔的仿建景观，可以从塔身的结构看起。' });
    const before = model.packets;
    for (let i = 0; i < 3; i++) model.receive({ type: 'response.audio.delta', response_id: 'response-1', item_id: 'answer-1', content_index: 0, delta: pcm.toString('base64') });
    await page.waitForFunction(() => window.__store.get().guideStatus === 'speaking');
    await page.screenshot({ path: `agent-tmp/calls/${label}-speaking.png` });
    assert.ok(model.packets > before, 'mic must continue sending while the model plays');
    model.receive({ type: 'input_audio_buffer.speech_started' });
    await page.waitForFunction(() => window.__audio.filter(row => row.source.buffer?.sampleRate === 24000).every(row => row.stopped || row.ended));
    assert.ok(model.commands.some(e => e.type === 'response.cancel'));
    await page.waitForFunction(() => window.__store.get().callInput === 'speaking');
    model.receive({ type: 'response.audio.delta', response_id: 'response-1', item_id: 'answer-1', content_index: 0, delta: pcm.toString('base64') });
    await page.locator('#call-mute').click();
    assert.equal(await page.locator('#call-mute').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => window.__streams[0].getAudioTracks()[0].enabled), false);
    await page.screenshot({ path: `agent-tmp/calls/${label}-muted.png` });
    await page.locator('#call-mute').click();
    assert.equal(await page.evaluate(() => window.__streams[0].getAudioTracks()[0].enabled), true);
    const hitTargets = await page.locator('#live-call-button, #call-mute').evaluateAll(nodes => nodes.map(node => {
      const r = node.getBoundingClientRect(); return r.width >= 44 && r.height >= 44 && node.contains(document.elementFromPoint(r.x + r.width/2, r.y + r.height/2));
    }));
    assert.ok(hitTargets.every(Boolean), `${label}: call controls must be visible and tappable`);
    await page.locator('#live-call-button').click();
    await page.waitForFunction(() => window.__streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')));
    await page.locator('#live-call-button').click();
    await page.waitForFunction(() => window.__store.get().callState === 'connected');
    assert.equal(await page.evaluate(() => window.__streams.length), 2);
    upstreams.at(-1).terminate();
    await page.waitForFunction(() => window.__store.get().callState === 'error');
    assert.equal(await page.locator('#call-retry').isVisible(), true);
    await page.screenshot({ path: `agent-tmp/calls/${label}-disconnected.png` });
    await page.locator('#call-retry').click();
    await page.waitForFunction(() => window.__store.get().callState === 'connected');
    await page.locator('#live-call-button').click();
    // WAV decoding and cue playback are exercised by real Web Audio, without autoplay bypass.
    assert.ok(await page.evaluate(() => window.__audio.some(row => row.source.buffer?.duration > .5 && row.source.buffer?.sampleRate !== 24000)), 'connected sample was decoded and played');
    assert.deepEqual(errors, []); await page.close();
    console.log(`${label}: full-duplex packets, interruption, mute, samples, hangup, redial and failure recovery OK`);
  }
} finally { await browser?.close(); await proxy.close(); }
