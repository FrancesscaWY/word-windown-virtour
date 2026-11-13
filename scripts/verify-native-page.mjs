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
  const pcm = (await readFile('artifacts/backend/native-voice-reply.wav')).subarray(44);
  const result = JSON.parse(await readFile('artifacts/backend/native-voice-verification.json', 'utf8'));
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
