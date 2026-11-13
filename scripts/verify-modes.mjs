import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || pathToFileURL(`${homedir()}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`).href);
const base = process.env.DEMO_URL || 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ executablePath:process.env.CHROME_PATH || '/usr/bin/google-chrome', headless:true, args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader'] });
await mkdir('artifacts/modes', { recursive:true });
try {
  for (const viewport of [{ width:390, height:844 }, { width:1440, height:900 }, { width:844, height:390 }, { width:320, height:740 }]) {
    const context = await browser.newContext({ viewport, reducedMotion:'reduce' });
    // Keep this layout matrix on its deterministic browser speech double.
    // The backend-native transport has separate integration coverage.
    await context.route('**/src/services/native-voice.js', route => route.fulfill({ contentType:'text/javascript', body:'export const createNativeVoiceService = ({ browserSpeech }) => browserSpeech;' }));
    // Deterministic APIs exercise real application code. No physical microphone or GPS is read.
    await context.addInitScript(() => {
      window.__modeVoice = { active:0, spoken:[], starts:0, cancels:0, holdSpeech:false, current:null };
      window.__modeGPS = { watches:0, clears:0, callback:null };
      const metrics = window.__modeVoice;
      class Recognition {
        start() { metrics.recognition = this; this.running = true; metrics.active++; metrics.starts++; queueMicrotask(() => this.running && this.onstart?.()); }
        abort() { if (this.running) metrics.active--; this.running = false; this.onend?.(); }
        stop() { this.abort(); }
      }
      Object.defineProperty(window, 'SpeechRecognition', { configurable:true, value:Recognition });
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable:true, value:class { constructor(text) { this.text = text; } } });
      let playback = null, timer = null;
      Object.defineProperty(window, 'speechSynthesis', { configurable:true, value:{
        getVoices:() => [{ lang:'zh-CN', name:'测试声音' }],
        cancel() { metrics.cancels++; clearTimeout(timer); const old = playback; playback = null; metrics.current = null; old?.onerror?.({ error:'canceled' }); },
        speak(utterance) {
          if (metrics.active) throw new Error('Capture overlapped narration');
          playback = utterance; metrics.current = utterance; metrics.spoken.push(utterance.text); utterance.onstart?.();
          timer = setTimeout(() => { if (playback === utterance) { playback = null; utterance.onend?.(); } }, metrics.holdSpeech ? 60000 : 60);
        },
      } });
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => ({ getTracks:() => [{ stop() {} }] });
      Object.defineProperty(navigator, 'geolocation', { configurable:true, value:{
        watchPosition(callback) { window.__modeGPS.watches++; window.__modeGPS.callback = callback; return window.__modeGPS.watches; },
        clearWatch() { window.__modeGPS.clears++; window.__modeGPS.callback = null; },
      } });
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(new URL('./tour.html?mode=interactive', base).href);
    const listen = async () => {
      try { await page.waitForFunction(() => document.querySelector('#speech-button').dataset.listening === 'true'); }
      catch (error) {
        console.error(await page.evaluate(async () => {
          const { store } = await import('/src/guide/store.js');
          const { guideStatus, voiceSession, voiceErrorCode, guideError, microphoneState, companionPaused } = store.get();
          return { guideStatus, voiceSession, voiceErrorCode, guideError, microphoneState, companionPaused, hint:document.querySelector('#voice-hint').textContent, metrics:window.__modeVoice };
        }));
        throw error;
      }
    };
    const mode = async name => { await page.locator('#mode-button').click(); await page.getByRole('button', { name, exact:true }).click(); };
    const snapshot = async label => {
      const dimensions = await page.evaluate(() => {
        const app = document.querySelector('#app').getBoundingClientRect();
        const elements = [...document.querySelectorAll('.app-header,.tour-workspace,.voice-dock,#voice-form')];
        return { horizontal:document.documentElement.scrollWidth > innerWidth,
          clipped:elements.filter(element => { const box = element.getBoundingClientRect(); return box.width && box.height && (box.left < -1 || box.right > app.right + 1 || box.top < app.top - 1 || box.bottom > app.bottom + 1); }).map(element => element.className),
        };
      });
      if (dimensions.horizontal || dimensions.clipped.length || errors.length) throw new Error(JSON.stringify({ viewport, label, dimensions, errors }));
      await page.screenshot({ path:`artifacts/modes/${label}-${viewport.width}x${viewport.height}.png` });
    };
    await listen();
    if (!await page.locator('#voice-hint').textContent().then(text => text.includes('正在聆听'))) throw new Error('Missing listening hint');
    if (await page.locator('.tour-hint-bar').count()) throw new Error('Removed top greetings returned');
    if (await page.locator('#guide-caption').isVisible() || await page.locator('#guide-state-label').isVisible()) throw new Error('Duplicate voice text remains');
    if (await page.locator('.arrival-mode-return').count()) throw new Error('Mode return hint remains');
    await snapshot('interactive-voice');
    // Hold actual application playback so the narration indicator can be inspected.
    await page.evaluate(() => {
      window.__modeVoice.holdSpeech = true;
      window.__modeVoice.recognition.onresult({ results:[Object.assign([{ transcript:'凯旋门人多吗' }], { isFinal:true })] });
    });
    await page.waitForSelector('#speech-button[data-voice-state="speaking"]');
    if (await page.locator('#speech-button .narration-bar').count() !== 3 || !await page.locator('#voice-hint').textContent().then(text => text === '正在讲解 · 点击打断')) throw new Error('Missing live narration indicator');
    if (await page.locator('#guide-playback-icon .narration-bar').count() !== 3) throw new Error('Portrait retained a playback symbol');
    await page.emulateMedia({ reducedMotion:'no-preference' });
    const bar = page.locator('#speech-button .narration-bar').first();
    if (await bar.evaluate(element => getComputedStyle(element).animationName) !== 'narration-wave') throw new Error('Narration bars are not animated');
    await snapshot('interactive-narrating');
    await page.emulateMedia({ reducedMotion:'reduce' });
    if (await bar.evaluate(element => getComputedStyle(element).animationName) !== 'none') throw new Error('Reduced motion must leave narration bars static');
    await page.evaluate(() => { window.__modeVoice.holdSpeech = false; });
    await page.locator('#speech-button').click();
    await listen();
    if (await page.locator('#speech-button .narration-bar').count()) throw new Error('Narration indicator continued after interruption');
    await page.getByRole('button', { name:'切换文字交流' }).click();
    await page.waitForSelector('#app[data-workspace="split"]');
    if (await page.evaluate(() => window.__modeVoice.active)) throw new Error('Text input retained microphone capture');
    await page.locator('#voice-input').fill('凯旋门人多吗'); await page.getByRole('button', { name:'发送', exact:true }).click();
    await page.waitForFunction(() => document.querySelector('#conversation-log').textContent.includes('没有实时人流'));
    const split = await page.evaluate(() => {
      const a = document.querySelector('.tour-workspace').getBoundingClientRect(), b = document.querySelector('.voice-dock').getBoundingClientRect();
      const horizontal = innerWidth >= 900 || innerWidth >= 600 && innerHeight <= 580;
      const scene = horizontal ? a.width : a.height, chat = horizontal ? b.width : b.height;
      return Math.abs(scene / (scene + chat) - .4);
    });
    if (split > .01) throw new Error(`Text panels do not start at 4:6: ${split}`);
    const divider = page.locator('#workspace-divider');
    const box = await divider.boundingBox();
    const horizontal = viewport.width >= 900 || viewport.width >= 600 && viewport.height <= 580;
    const start = { x:box.x + box.width/2, y:box.y + box.height/2 };
    await page.mouse.move(start.x,start.y); await page.mouse.down();
    await page.mouse.move(start.x + (horizontal ? 50 : 0), start.y + (horizontal ? 0 : 45), { steps:6 }); await page.mouse.up();
    if (Number(await divider.getAttribute('aria-valuenow')) <= 40) throw new Error('Dragging did not resize the panes');
    const resizedShare = await page.evaluate(horizontal => {
      const a = document.querySelector('.tour-workspace').getBoundingClientRect(), b = document.querySelector('.voice-dock').getBoundingClientRect();
      return horizontal ? a.width/(a.width+b.width) : a.height/(a.height+b.height);
    }, horizontal);
    if (resizedShare < .43) throw new Error(`The actual panes did not resize: ${resizedShare}`);
    await divider.focus(); await page.keyboard.press(horizontal ? 'ArrowLeft' : 'ArrowUp');
    await page.keyboard.press('Enter');
    if (await divider.getAttribute('aria-valuenow') !== '40') throw new Error('Separator reset failed');
    await divider.blur();
    await snapshot('interactive-text');
    await mode('沉浸模式');
    if (await page.evaluate(() => window.__modeVoice.active)) throw new Error('Immersive mode retained microphone capture');
    await page.locator('#companion-emotion').waitFor();
    await page.locator('#voice-input').fill('介绍凯旋门'); await page.getByRole('button', { name:'发送', exact:true }).click();
    await page.waitForFunction(() => document.querySelector('#conversation-log').textContent.includes('凯旋门'));
    await page.waitForFunction(() => { const photo = document.querySelector('#scene-photo'); return document.querySelector('#photo-scene').hidden || photo.complete && photo.naturalWidth > 0 && document.querySelector('#photo-status').hidden; });
    await snapshot('immersive');
    await page.locator('#voice-input').fill('推荐一处风景'); await page.getByRole('button', { name:'发送', exact:true }).click();
    await page.getByRole('button', { name:'前往埃菲尔铁塔并展开解说', exact:true }).waitFor();
    await page.locator('#conversation-dismiss').click();
    if (await page.locator('#conversation-recommendation').isVisible()) throw new Error('Dismissed recommendation remained visible');
    await page.locator('#voice-input').fill('推荐一处风景'); await page.getByRole('button', { name:'发送', exact:true }).click();
    await page.getByRole('button', { name:'前往埃菲尔铁塔并展开解说', exact:true }).click();
    await page.locator('#panorama-scene:not([hidden])').waitFor();
    if (await page.locator('#detail-panel').count()) throw new Error('A standalone text introduction returned');
    await page.waitForFunction(() => document.querySelector('#conversation-log').textContent.includes('塔'));
    if (!await page.locator('#panorama-scene').isVisible()) throw new Error('Expanded explanation hid the panorama');
    await snapshot('immersive-explanation');
    await page.locator('#back-map').click();
    await mode('伴游模式'); await listen();
    if (await page.locator('#trail-settings, .trail-badge, .location-simulator [data-collapse], .location-simulator [data-source]').count()) throw new Error('Removed location options remain');
    if (await page.evaluate(() => window.__modeGPS.watches)) throw new Error('Default simulation requested GPS');
    const simulatedPosition = () => page.evaluate(async () => {
      const { store } = await import('/src/guide/store.js');
      window.__modeLocationStore = store;
      return { ...store.get().visitorOrigin, source:store.get().visitorOriginSource };
    });
    const initialPosition = await simulatedPosition();
    if (initialPosition.source !== '模拟定位' || !Number.isFinite(initialPosition.latitude)) throw new Error('Companion did not start simulated location automatically');
    await page.waitForFunction(() => [...document.querySelectorAll('.movement-trail path')].some(path => path.getAttribute('d').includes('L')));
    await page.waitForFunction(initial => {
      const point = window.__modeLocationStore.get().visitorOrigin;
      return point && (point.latitude !== initial.latitude || point.longitude !== initial.longitude);
    }, initialPosition);
    const movingPosition = await simulatedPosition();
    if (movingPosition.latitude === initialPosition.latitude && movingPosition.longitude === initialPosition.longitude) throw new Error('Simulated position did not advance');
    if (!await page.locator('#companion-pet').isVisible() || await page.locator('#conversation-panel').isVisible()) {
      await page.screenshot({path:'artifacts/modes/companion-debug.png'});
      console.log(await page.evaluate(() => ({pet:document.querySelector('#companion-pet').outerHTML.slice(0,420),stage:document.querySelector('.scene-surface').getBoundingClientRect().toJSON(),toolbar:document.querySelector('.top-categories').getBoundingClientRect().toJSON(),mode:document.querySelector('#app').dataset})));
      throw new Error('Companion needs a visible guide on its map');
    }
    for (const selector of ['#companion-guide','#companion-emotion','#companion-action']) {
      if (await page.locator(selector).isVisible()) throw new Error(`Test-only companion control remains visible: ${selector}`);
    }
    await page.waitForFunction(() => document.querySelector('#companion-pet').dataset.mode === 'otter-watercolor');
    if (!await page.locator('.movement-trail path').evaluateAll(paths => paths.some(path => path.getAttribute('d').includes('L')))) throw new Error('Position updates did not paint a trail');
    if (!await page.evaluate(() => window.__modeVoice.spoken.some(text => text.startsWith('你已来到')))) throw new Error('No location narration');
    const companionOverlaps = await page.evaluate(() => {
      const pet = document.querySelector('#companion-pet').getBoundingClientRect();
      return ['.top-categories','.voice-dock'].filter(selector => {
        const box = document.querySelector(selector).getBoundingClientRect();
        return pet.left < box.right && pet.right > box.left && pet.top < box.bottom && pet.bottom > box.top;
      });
    });
    if (companionOverlaps.length) throw new Error(`Companion covers controls: ${companionOverlaps.join(',')}`);
    await snapshot('companion');
    // Exercise the actual visibility handler while narration is still in flight.
    await page.evaluate(async () => {
      window.__modeVoice.holdSpeech = true;
      document.querySelector('#catalog-search').value = '埃菲尔铁塔';
      document.querySelector('#catalog-search').dispatchEvent(new Event('input'));
      document.querySelector('[data-catalog-poi="eiffel"]').click();
      const { store } = await import('/src/guide/store.js');
      if (store.get().guideStatus !== 'speaking') throw new Error('Narration did not start');
      const cancels = window.__modeVoice.cancels;
      Object.defineProperty(document, 'hidden', { configurable:true, value:true });
      document.dispatchEvent(new Event('visibilitychange'));
      if (window.__modeVoice.cancels !== cancels || store.get().guideStatus !== 'speaking') throw new Error('Backgrounding cancelled companion narration');
      if (window.__modeVoice.active) throw new Error('Background companion kept microphone capture');
      window.__modeVoice.current.onend();
      await new Promise(resolve => setTimeout(resolve, 750));
      if (window.__modeVoice.active) throw new Error('Background narration restarted microphone');
      Object.defineProperty(document, 'hidden', { configurable:true, value:false });
      window.__modeVoice.holdSpeech = false;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await listen();
    await page.getByRole('button', { name:'暂停伴游', exact:true }).click();
    if (await page.evaluate(() => window.__modeVoice.active)) throw new Error('Paused companion retained microphone capture');
    const pausedPosition = await simulatedPosition();
    await page.waitForTimeout(600);
    if (JSON.stringify(await simulatedPosition()) !== JSON.stringify(pausedPosition)) throw new Error('Paused companion kept moving');
    await page.getByRole('button', { name:'恢复伴游', exact:true }).click(); await listen();
    await page.waitForTimeout(600);
    if (JSON.stringify(await simulatedPosition()) === JSON.stringify(pausedPosition)) throw new Error('Companion did not resume simulated movement');
    await mode('沉浸模式');
    if (await page.evaluate(() => window.__modeGPS.callback !== null || window.__modeVoice.active)) throw new Error('Mode exit retained capture or location watch');
    await context.close();
  }
  const denied = await browser.newContext({ viewport:{ width:390, height:844 }, reducedMotion:'reduce' });
  await denied.route('**/src/services/native-voice.js', route => route.fulfill({ contentType:'text/javascript', body:'export const createNativeVoiceService = ({ browserSpeech }) => browserSpeech;' }));
  await denied.addInitScript(() => {
    Object.defineProperty(window, 'SpeechRecognition', { configurable:true, value:class {
      start() { queueMicrotask(() => this.onerror?.({ error:'not-allowed' })); }
      abort() { this.onend?.(); }
      stop() { this.abort(); }
    } });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable:true, value:class { constructor(text) { this.text = text; } } });
    Object.defineProperty(window, 'speechSynthesis', { configurable:true, value:{
      getVoices:() => [], cancel() {}, speak(item) { item.onstart?.(); queueMicrotask(() => item.onend?.()); },
    } });
  });
  const deniedPage = await denied.newPage();
  await deniedPage.goto(new URL('./tour.html?mode=companion', base).href);
  await deniedPage.waitForSelector('#speech-button[data-voice-state="error"]');
  if (!await deniedPage.locator('#voice-hint').textContent().then(text => text.includes('麦克风未授权'))) throw new Error('Missing permission explanation');
  const deniedIcon = await deniedPage.locator('#speech-button').innerHTML();
  if (!deniedIcon.includes('M9 9v3') || deniedIcon.includes('m9 5 11 7-11 7Z')) throw new Error('Denied microphone has the wrong icon');
  await deniedPage.screenshot({ path:'artifacts/modes/companion-permission-denied-390x844.png' });
  await denied.close();
  console.log('Four viewport sizes: mode layouts, draggable 4:6 splits, recommendation navigation/dismissal, permission icon, automatic simulated trails, pause/resume and return to listening verified.');
} finally { await browser.close(); }
