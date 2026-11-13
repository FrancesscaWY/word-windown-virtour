import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || pathToFileURL(`${homedir()}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`).href);
const base = process.env.DEMO_URL || 'http://127.0.0.1:5173/';
const url = path => new URL(path, base).href;
await mkdir('artifacts/arrival', { recursive:true });
const browser = await chromium.launch({ executablePath:process.env.CHROME_PATH || '/usr/bin/google-chrome', headless:true, args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader'] });
try {
  // Normal motion: verify the sequence actually exists and finishes visibly.
  // Keep the reduced-motion viewport/functional matrix below independent.
  const animated = await browser.newContext({ viewport:{ width:390, height:844 }, reducedMotion:'no-preference' });
  const motionPage = await animated.newPage();
  const settle = async () => {
    await motionPage.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth));
    await motionPage.evaluate(() => Promise.all(document.getAnimations().filter(animation =>
      Number.isFinite(animation.effect.getComputedTiming().iterations)
    ).map(animation => animation.finished.catch(() => {}))));
  };
  await motionPage.goto(url('./'));
  const sequence = await motionPage.evaluate(() => Object.fromEntries(
    ['.welcome-title','.welcome-world','.welcome-mascot','.welcome-footer'].map(selector => [selector, getComputedStyle(document.querySelector(selector)).animationName])
  ));
  if (Object.values(sequence).some(name => name === 'none')) throw new Error(`Missing welcome animation: ${JSON.stringify(sequence)}`);
  await settle();
  await motionPage.getByRole('button', { name:'和窗小游打个招呼' }).click();
  await motionPage.waitForFunction(() => document.querySelector('#welcome-message').textContent === '出发吧，世界等着你！');
  await settle();
  await motionPage.screenshot({ path:'artifacts/arrival/welcome-motion-settled.png', fullPage:true });
  await motionPage.getByRole('link', { name:'左滑或点击，选择游览模式' }).click();
  await motionPage.waitForURL('**/modes.html');
  await settle();
  const delays = await motionPage.locator('.mode-cards > li').evaluateAll(cards => cards.map(card => getComputedStyle(card).animationDelay));
  if (new Set(delays).size !== 3) throw new Error('Mode cards must arrive in sequence');
  await motionPage.screenshot({ path:'artifacts/arrival/modes-motion-settled.png', fullPage:true });
  await motionPage.goBack();
  await motionPage.waitForURL(url('./'));
  if (await motionPage.locator('body').evaluate(body => body.classList.contains('is-leaving'))) throw new Error('Back navigation left the welcome page hidden');
  await animated.close();
  for (const viewport of [{width:320,height:568}, {width:320,height:740}, {width:390,height:844}, {width:423,height:937}, {width:1440,height:900}, {width:844,height:390}]) {
    const context = await browser.newContext({ viewport, reducedMotion:'reduce' });
    // Fail the test if either introductory page asks to capture audio or location.
    await context.addInitScript(() => {
      window.__entryCaptures = 0;
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => { window.__entryCaptures++; return Promise.reject(new DOMException('Test capture denied', 'NotAllowedError')); };
      if (navigator.geolocation) navigator.geolocation.watchPosition = () => { window.__entryCaptures++; return 0; };
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(url('./'));
    await page.getByRole('link', {name:'左滑或点击，选择游览模式'}).waitFor();
    const checkIntro = async () => {
      const state = await page.evaluate(() => {
        const rect = element => {
          const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
          return { left, top, right, bottom, width, height };
        };
        const withinViewport = bounds => bounds.width > 0 && bounds.height > 0 && bounds.left >= -1 && bounds.top >= -1 && bounds.right <= innerWidth + 1 && bounds.bottom <= innerHeight + 1;
        const cards = [...document.querySelectorAll('.arrival-mode-card')].map(card => {
          const bounds = rect(card);
          const copy = [...card.querySelectorAll('h2, p')].map(rect);
          return { bounds, fits:withinViewport(bounds) && copy.every(text => withinViewport(text) && text.top >= bounds.top && text.bottom <= bounds.bottom) };
        });
        const footer = rect(document.querySelector('footer'));
        const title = document.querySelector('.welcome-title');
        const mascot = document.querySelector('.welcome-mascot');
        const companion = document.querySelector('.welcome-title-companion');
        let titleFits = true;
        if (title) {
          const t = rect(title), m = rect(mascot), c = rect(companion);
          const overlaps = t.left < m.right && t.right > m.left && t.top < m.bottom && t.bottom > m.top;
          titleFits = withinViewport(t) && withinViewport(c) && c.bottom <= t.bottom + 1 && !overlaps;
        }
        return {
          page:document.body.dataset.page,
          overflow:document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1,
          cards, footerFits:withinViewport(footer), titleFits,
          captures:window.__entryCaptures,
          unloaded:[...document.images].filter(image => !image.complete || !image.naturalWidth).map(image => image.src),
        };
      });
      if (state.overflow || !state.footerFits || !state.titleFits || state.cards.some(card => !card.fits) || state.captures || state.unloaded.length || errors.length) throw new Error(JSON.stringify({viewport, ...state, errors}));
    };
    if (await page.locator('.welcome-aside, .arrival-edition, .welcome-greeting p, .welcome-footer > p').count()) throw new Error('Redundant welcome slogans remain');
    if (await page.locator('#welcome-message').textContent() !== '你好，我是窗小游') throw new Error('Missing single-line welcome greeting');
    await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth));
    if (await page.locator('.welcome-title').evaluate(title => getComputedStyle(title).animationName !== 'none')) throw new Error('Reduced motion must disable entrance animations');
    await checkIntro();
    await page.screenshot({path:`artifacts/arrival/welcome-${viewport.width}x${viewport.height}.png`, fullPage:true});
    await page.getByRole('link', {name:'左滑或点击，选择游览模式'}).click();
    await page.waitForURL('**/modes.html');
    await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth));
    await checkIntro();
    await page.screenshot({path:`artifacts/arrival/modes-${viewport.width}x${viewport.height}.png`, fullPage:true});
    for (const [mode, label] of [['immersive','沉浸模式'], ['companion','伴游模式'], ['interactive','交互模式']]) {
      await page.goto(url('./modes.html'));
      await page.getByRole('link', {name:label, exact:true}).click();
      await page.waitForSelector(`#app[data-tour-mode="${mode}"]`);
      if (mode === 'immersive') {
        if (await page.evaluate(() => window.__entryCaptures)) throw new Error(`${mode} unexpectedly requested microphone/location`);
      }
      if (mode === 'companion') {
        await page.locator('.visitor-marker:not([hidden])').waitFor();
        if (await page.locator('#trail-settings, .location-simulator [data-collapse]').count()) throw new Error('Location options returned');
        for (const selector of ['#companion-guide','#companion-emotion','#companion-action']) {
          if (await page.locator(selector).isVisible()) throw new Error(`Test-only companion control remains visible: ${selector}`);
        }
      }
      else {
        if (!await page.locator('#conversation-starters').isVisible()) throw new Error('First map-dialogue entrance did not show examples');
      }
      await page.locator('#mode-button').click();
      if (await page.locator('.arrival-mode-return').count()) throw new Error('Extra return hint remains');
      await page.goBack();
      await page.waitForURL('**/modes.html');
    }
    await page.goto(url('./tour.html?mode=immersive'));
    await page.waitForSelector('#app[data-tour-mode="immersive"]');
    await page.locator('#open-catalog').click();
    await page.locator('#catalog-search').fill('埃菲尔铁塔');
    await page.locator('[data-catalog-poi="eiffel"]').click();
    await page.waitForSelector('body[data-page="panorama"]');
    await page.locator('#back-map').click();
    await page.waitForSelector('body[data-page="main"]');
    if (errors.length) throw new Error(JSON.stringify({viewport, errors}));
    await context.close();
  }
  console.log('Animated arrival, single-screen cards, separated title columns, history and reduced-motion layouts verified at six viewport sizes; three modes and panorama round trip passed.');
} finally { await browser.close(); }
