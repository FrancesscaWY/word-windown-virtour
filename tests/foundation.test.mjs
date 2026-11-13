import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createHandler } from '../server/handler.ts';
import { createApp } from '../server/app.ts';
import { pois } from '../src/data/pois.js';
import { createStore } from '../src/guide/store.js';
import { createSpeechService } from '../src/services/speech.js';
import { getBrowserCapabilities } from '../src/services/capabilities.js';

test('sourced catalog has unique IDs and only exposes the Eiffel cubemap', () => {
  assert.ok(pois.length > 100); assert.equal(new Set(pois.map(poi => poi.id)).size, pois.length);
  assert.deepEqual(pois.filter(poi => poi.panorama).map(poi => poi.id), ['eiffel']);
  const panorama = pois.find(poi => poi.id === 'eiffel').panorama;
  assert.equal(panorama.kind, 'cubemap');
  assert.deepEqual(panorama.faces.map(path => path.split('/').at(-1)), ['r-l3-fallback.jpg', 'l-l3-fallback.jpg', 'u-l3-fallback.jpg', 'd-l3-fallback.jpg', 'f-l3-fallback.jpg', 'b-l3-fallback.jpg']);
  assert.equal(pois.find(poi => poi.id === 'eiffel').panoramaKind, 'cubemap');
  assert.match(pois.find(poi => poi.id === 'eiffel').panoramaLabel, /实景全景/);
  for (const poi of pois) {
    assert.ok(poi.source.startsWith('https://'));
    if (poi.position) { assert.ok(poi.position.x > 0 && poi.position.x < 100); assert.ok(poi.position.y > 0 && poi.position.y < 100); }
    else assert.equal(poi.locationVerified, false);
  }
});

test('Eiffel cubemap includes all six JPEG faces', async () => {
  const faces = pois.find(poi => poi.id === 'eiffel').panorama.faces;
  for (const face of faces) {
    const asset = await readFile(new URL(`../public/${face.slice(2)}`, import.meta.url));
    assert.equal(asset.subarray(0, 2).toString('hex'), 'ffd8');
    assert.ok(asset.length > 1_000_000);
  }
});

test('browsing a scene never silently changes visitor physical origin', () => {
  const store = createStore(); const before = store.get().visitorOrigin;
  store.set({ selectedPoiId: 'arc', view: 'panorama' }); assert.equal(store.get().visitorOrigin, before);
});

test('static server preserves page, source and panorama responses', async () => {
  const handler = createHandler();
  for (const path of ['/', '/src/main.js', '/styles.css', '/assets/panoramas/eiffel-tower/r-l3-fallback.jpg']) {
    const res = await handler(new Request(`http://localhost${path}`)); assert.equal(res.status, 200, path);
  }
});

test('missing keys never claim live AI or produce demo answers', async t => {
  const app = createApp({ env: { UNRELATED_SECRET: 'test-secret-must-never-leak' } });
  t.after(() => app.close());
  const res = await app.inject('/api/status');
  assert.ok(!res.body.includes('test-secret'));
  assert.equal(res.json().mode, 'unconfigured'); assert.equal(res.json().credentialsPresent, false);
  const guide = await app.inject({ method: 'POST', url: '/api/guide', payload: { text: '世界之窗有什么特色' } });
  assert.equal(guide.statusCode, 503); assert.equal(guide.json().text, undefined);
});

test('environment and repository files are not exposed by the static server', async () => {
  const handler = createHandler();
  for (const path of ['/.env', '/.git/config', '/package.json', '/server/index.ts', '/assets/%2e%2e%2f%2eenv', '/src/%2e%2e%2fserver/index.ts']) {
    const res = await handler(new Request(`http://localhost${path}`)); assert.equal(res.status, 404, path);
  }
  assert.equal((await handler(new Request('http://localhost/%E0%A4%A'))).status, 400);
});

test('unsupported voice returns an explicit result without asking permission', async () => {
  const speech = createSpeechService({ isSecureContext: false });
  assert.equal((await speech.recognizeOnce()).status, 'unsupported');
  assert.equal((await speech.speak('hello')).status, 'unsupported');
  assert.equal(getBrowserCapabilities({}).speechRecognition, false);
});

test('stopping recognition resolves its promise and ignores late recognition events', async () => {
  let instance;
  class Recognition { constructor() { instance = this; } start() {} abort() {} }
  const service = createSpeechService({ isSecureContext: true, SpeechRecognition: Recognition });
  let transcript = '';
  const pending = service.recognizeOnce(text => { transcript = text; });
  service.stop(); assert.equal((await pending).status, 'cancelled');
  instance.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'late result' }], { isFinal: true })] });
  assert.equal(transcript, '');
});

test('a completed recognition round ignores late transcripts after its result has been submitted', async () => {
  let instance;
  class Recognition { constructor() { instance = this; } start() {} abort() {} }
  const service = createSpeechService({ isSecureContext: true, SpeechRecognition: Recognition });
  const transcripts = [];
  const pending = service.recognizeOnce(text => transcripts.push(text));
  const resultEvent = text => ({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] });
  instance.onresult(resultEvent('带我看铁塔'));
  instance.onend();
  assert.deepEqual(await pending, { status: 'success', text: '带我看铁塔' });
  instance.onresult(resultEvent('迟到的识别'));
  assert.deepEqual(transcripts, ['带我看铁塔']);
});

test('stopping speech resolves its promise rather than leaving a busy UI', async () => {
  const scope = { SpeechSynthesisUtterance: class {}, speechSynthesis: { cancel() {}, speak() {} } };
  const service = createSpeechService(scope); const pending = service.speak('test');
  service.stopSpeaking(); assert.equal((await pending).status, 'cancelled');
});
