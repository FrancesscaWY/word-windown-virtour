import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createHandler } from '../server/handler.mjs';
import { tourModeFromSearch, isWelcomeSwipe, mountWelcomeSwipe } from '../src/arrival/navigation.js';

test('only the three real tour modes can be selected by a page address', () => {
  for (const mode of ['interactive', 'immersive', 'companion']) assert.equal(tourModeFromSearch(`?mode=${mode}`), mode);
  for (const search of ['', '?mode=', '?mode=other', '?mode=%22%5D', '?mode=__proto__']) assert.equal(tourModeFromSearch(search), 'interactive');
});

test('welcome swipe distinguishes next-page intent from scrolling, taps and a held pointer', () => {
  const start = { x:200, y:100, time:10 };
  assert.equal(isWelcomeSwipe(start, { x:120, y:108, time:350 }), true);
  for (const end of [
    { x:150, y:100, time:350 }, { x:280, y:100, time:350 },
    { x:120, y:200, time:350 }, { x:120, y:108, time:1600 },
    { x:120, y:108, time:0 }, { x:NaN, y:100, time:350 },
  ]) assert.equal(isWelcomeSwipe(start, end), false);
  assert.equal(isWelcomeSwipe(null, start), false);
});

test('swiping ignores controls, secondary pointers and cancelled gestures; cleanup removes handlers', () => {
  const listeners = new Map(); let navigations = 0;
  const element = {
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type, fn) { assert.equal(listeners.get(type), fn); listeners.delete(type); },
  };
  const dispose = mountWelcomeSwipe(element, () => navigations++);
  const event = patch => ({ pointerId:1, button:0, isPrimary:true, clientX:220, clientY:100, timeStamp:10, target:{ closest:() => null }, ...patch });
  const swipe = (down = {}, up = {}) => { listeners.get('pointerdown')(event(down)); listeners.get('pointerup')(event({ clientX:90, timeStamp:300, ...up })); };
  swipe(); assert.equal(navigations, 1);
  swipe({ target:{ closest:() => ({ tagName:'A' }) } });
  swipe({ isPrimary:false }); swipe({ button:2 });
  assert.equal(navigations, 1);
  swipe({}, { pointerId:2 }); assert.equal(navigations, 1);
  listeners.get('pointercancel')();
  listeners.get('pointerup')(event({ clientX:90, timeStamp:300 }));
  assert.equal(navigations, 1);
  swipe({}, { clientY:300 }); assert.equal(navigations, 1);
  dispose(); assert.equal(listeners.size, 0);
});

test('welcome and mode routes use real links and can load without mounting capture or the tour', async () => {
  const handler = createHandler();
  const welcome = await (await handler(new Request('http://localhost/'))).text();
  const modes = await (await handler(new Request('http://localhost/modes.html'))).text();
  assert.match(welcome, /data-page="welcome"/);
  assert.match(welcome, /id="welcome-enter" href="\.\/modes\.html"/);
  assert.match(welcome, /alt="世界之旅，AI 伴游"/);
  assert.doesNotMatch(welcome + modes, /src="[^"\n]*(?:main|tour-entry)\.js/);
  assert.match(modes, /src="\/src\/modes-page\.js"/);
  for (const [mode, label] of [['interactive', '地图对话'], ['companion', '伴游模式']]) {
    assert.match(modes, new RegExp(`href="\\./tour\\.html\\?mode=${mode}"`));
    assert.ok(modes.includes(label));
  }
  assert.doesNotMatch(modes, /tour\.html\?mode=immersive|沉浸模式/);
  const bridge = await readFile(new URL('../src/welcome-page.js', import.meta.url), 'utf8');
  const navigation = await readFile(new URL('../src/arrival/navigation.js', import.meta.url), 'utf8');
  const modesBridge = await readFile(new URL('../src/modes-page.js', import.meta.url), 'utf8');
  const presentation = await readFile(new URL('../src/arrival/presentation.js', import.meta.url), 'utf8');
  assert.doesNotMatch(bridge + navigation + modesBridge + presentation, /getUserMedia|SpeechRecognition|geolocation|main\.js/);
});

test('all local entry assets and scripts resolve through the existing server', async () => {
  const handler = createHandler();
  const pages = ['index.html', 'modes.html', 'tour.html'];
  const assets = new Set();
  for (const page of pages) {
    const response = await handler(new Request(`http://localhost/${page}`));
    assert.equal(response.status, 200);
    const html = await response.text();
    for (const match of html.matchAll(/(?:src|href)="((?:\.\/assets\/|\/src\/|\.\/styles\.css)[^"]+)"/g)) assets.add(new URL(match[1], `http://localhost/${page}`).pathname);
  }
  for (const path of assets) assert.equal((await handler(new Request(`http://localhost${path}`))).status, 200, path);
  const tour = await (await handler(new Request('http://localhost/tour.html?mode=companion'))).text();
  assert.match(tour, /id="app"/);
  assert.match(tour, /src="\/src\/tour-entry\.js"/);
});

test('derived artwork has reproducible hashes and keeps its supplied image dimensions', async () => {
  const base = new URL('../public/assets/arrival/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));
  for (const [file, expected] of Object.entries(manifest.files)) {
    const bytes = await readFile(new URL(file, base));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, file);
    assert.equal(bytes.subarray(1,4).toString(), 'PNG');
    assert.ok(bytes.readUInt32BE(16) > 40 && bytes.readUInt32BE(20) >= 30, file);
  }
});
