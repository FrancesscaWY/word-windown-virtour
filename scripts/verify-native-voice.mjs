import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = await import(pathToFileURL(process.env.VIRTOUR_PLAYWRIGHT_PATH ?? `${homedir()}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`).href);
const origin = process.env.DEMO_URL ?? 'http://127.0.0.1:5174';
const audioPath = new URL('../artifacts/backend/voice-input.wav', import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${audioPath}%noloop`] });
await mkdir('artifacts/backend', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/tour.html?mode=immersive`);
  await page.waitForSelector('#voice-input');
  const status = await (await page.request.get(`${origin}/api/status`)).json();
  assert.equal(status.nativeVoice.ready, true); assert.equal(status.asr, 'backend-native');
  await page.evaluate(async () => {
    const { createNativeVoiceService } = await import('/src/services/native-voice.js');
    const { createSpeechService } = await import('/src/services/speech.js');
    window.__nativeTest = { phase: 'ready', starts: 0, transcripts: [], browserTts: 0, browserAsr: 0 };
    const browser = createSpeechService();
    const originalSpeak = browser.speak;
    browser.speak = (...args) => { window.__nativeTest.browserTts++; return originalSpeak(...args); };
    window.SpeechRecognition = class { constructor() { window.__nativeTest.browserAsr++; throw new Error('Browser ASR must not run'); } };
    const service = createNativeVoiceService({ browserSpeech: browser, fetchImpl: async (...args) => {
      const response = await fetch(...args);
      window.__voiceWire = response.clone().text();
      return response;
    } });
    const button = document.createElement('button'); button.id = 'verify-native-start'; button.style.cssText = 'position:fixed;top:5px;left:5px;z-index:99999;padding:12px'; button.textContent = '验证后端原生语音';
    document.body.append(button);
    button.onclick = async () => {
      void service.unlock();
      const test = window.__nativeTest;
      try {
        const permission = await service.requestMicrophone();
        if (permission.status !== 'granted') throw new Error(JSON.stringify(permission));
        test.phase = 'recording';
        const recording = await service.recognizeOnce(() => {}, { onStart() { test.captureStarted = true; } });
        if (recording.status !== 'success') throw new Error(JSON.stringify(recording));
        test.inputBytes = atob(recording.audio).length;
        test.phase = 'responding';
        const result = await service.respondToAudio(recording.audio, {}, { onTranscript(text) { test.transcripts.push(text); }, onStart() { test.starts++; }, onAnswer(event) { test.answer = event; document.querySelector('#guide-caption').textContent = event.content; } });
        if (result.status !== 'success') throw new Error(JSON.stringify(result));
        test.phase = 'replaying';
        const replay = service.speak(test.answer.content, { onStart() { test.starts++; } });
        setTimeout(() => service.stopSpeaking(), 100);
        test.replayResult = await replay;
        test.wire = await window.__voiceWire;
        service.dispose();
        test.phase = 'complete';
      } catch (error) { test.phase = 'error'; test.error = error.message; service.dispose(); }
    };
  });
  await page.locator('#verify-native-start').click();
  await page.waitForFunction(() => ['complete', 'error'].includes(window.__nativeTest.phase), null, { timeout: 150000 });
  const result = await page.evaluate(() => window.__nativeTest);
  assert.equal(result.phase, 'complete', result.error);
  assert.ok(result.captureStarted); assert.ok(result.inputBytes >= 3200);
  assert.ok(result.starts >= 1); assert.ok(result.transcripts.length > 0);
  assert.equal(result.browserTts, 0); assert.equal(result.browserAsr, 0); assert.equal(result.replayResult.status, 'cancelled');
  const events = result.wire.trim().split('\n').map(line => JSON.parse(line));
  const chunks = events.filter(event => event.type === 'audio_delta').map(event => Buffer.from(event.audio, 'base64'));
  assert.ok(chunks.length > 0);
  const pcm = Buffer.concat(chunks), wav = Buffer.alloc(44 + pcm.length);
  wav.write('RIFF'); wav.writeUInt32LE(36 + pcm.length, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44);
  await writeFile('artifacts/backend/native-voice-reply.wav', wav);
  delete result.wire;
  result.audioChunks = chunks.length; result.outputSeconds = pcm.length / 48000; result.pageErrors = errors;
  assert.deepEqual(errors, []);
  await writeFile('artifacts/backend/native-voice-verification.json', JSON.stringify(result, null, 2));
  await page.locator('#verify-native-start').evaluate(button => button.remove());
  await page.screenshot({ path: 'artifacts/backend/native-voice-mobile.png', fullPage: true });
  console.log(JSON.stringify(result, null, 2));
  // Exercise the real page controller with the verified wire format, without a second paid request.
  await page.route('**/api/voice', route => route.fulfill({ contentType: 'application/x-ndjson', body: [
    { type: 'input_transcript', transcript: '带我看铁塔' },
    { type: 'audio_delta', audio: pcm.subarray(0, 48000).toString('base64') },
    { type: 'answer', content: '原生语音页面联动验证通过。', model: 'qwen-audio-3.1-realtime-flash' },
  ].map(event => JSON.stringify(event)).join('\n') }));
  await page.goto(`${origin}/tour.html?mode=immersive`);
  await page.waitForSelector('#speech-button', { state: 'attached' });
  await page.evaluate(async () => {
    window.__pageUtterances = [];
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { cancel() {}, resume() {}, getVoices() { return []; }, speak(utterance) { window.__pageUtterances.push(utterance.text); setTimeout(() => { utterance.onstart?.(); utterance.onend?.(); }, 0); } } });
    const { store } = await import('/src/guide/store.js');
    store.set({ tourMode: 'interactive', interactionInput: 'voice' });
  });
  await page.locator('#speech-button').click();
  await page.waitForFunction(() => document.querySelector('#guide-caption').textContent.includes('原生语音页面联动验证通过'), null, { timeout: 25000 });
  await page.waitForFunction(() => document.querySelector('#guide-presence').dataset.state === 'speaking');
  assert.equal(await page.locator('#panorama-scene').isVisible(), true);
  assert.equal(await page.evaluate(() => window.__pageUtterances.includes('原生语音页面联动验证通过。')), false);
  await page.locator('#speech-button').click();
  result.actualPageNativeAnswer = true; result.transcriptOpenedPanorama = true; result.actualPageInterruption = true;
  await writeFile('artifacts/backend/native-voice-verification.json', JSON.stringify(result, null, 2));
  console.log('PASS: actual page microphone -> voice stream -> panorama, mouth state and interruption.');
  console.log('PASS: microphone PCM -> native backend transcript/audio -> real PCM playback, replay and cancellation. No browser ASR/TTS.');
} finally { await browser.close(); }
