import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = await import(pathToFileURL(process.env.VIRTOUR_PLAYWRIGHT_PATH ?? `${homedir()}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`).href);

const output = new URL('../artifacts/animal-avatars/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const results = [];
const guides = [
  { id: 'otter-watercolor', surface: '#companion-otter-watercolor' },
  { id: 'dandelion-felt', surface: '#companion-dandelion-felt' },
];

async function choice(page, menu, label) {
  await page.locator(`#companion-${menu}`).click();
  const option = page.locator(`#companion-${menu}-options`).getByRole('option', { name: label, exact: true });
  await option.click();
}

async function readMotion(page) {
  return page.locator('#companion-pet').evaluate(pet => ({ x: pet.getBoundingClientRect().x, y: pet.getBoundingClientRect().y, height: pet.getBoundingClientRect().height, moving: pet.dataset.moving, action: pet.dataset.motionAction }));
}

try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${process.env.DEMO_URL || 'http://127.0.0.1:5173'}/tour.html`);
    await page.waitForFunction(() => document.querySelector('#companion-pet')?.dataset.mode === 'otter-watercolor');
    assert.equal(await page.locator('.guide-name strong').textContent(), '沐沐');
    assert.equal(await page.locator('#companion-guide [data-choice-value]').textContent(), '沐沐 · 水彩');
    assert.equal(await page.locator('#companion-otter-watercolor').isVisible(), true);
    await page.locator('#companion-roam').uncheck();
    for (const guide of guides) {
      await page.locator('#companion-guide').click();
      const list = page.locator('#companion-guide-options');
      assert.equal(await list.getByRole('option').count(), 12, 'preserve every existing guide');
      const option = list.locator(`[data-avatar-mode="${guide.id}"]`);
      await option.scrollIntoViewIfNeeded();
      assert.equal(await option.evaluate(element => {
        const box = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      }), true, 'the character cannot intercept its menu');
      await option.click();
      await page.waitForFunction(id => document.querySelector('#companion-pet')?.dataset.mode === id && document.querySelector('#companion-pet')?.getAttribute('aria-busy') === 'false', guide.id);
      await choice(page, 'emotion', '自然');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForTimeout(160);
      const neutral = await page.locator(guide.surface).screenshot({ path: new URL(`${viewport.width}-${guide.id}-neutral.png`, output).pathname });
      const painted = await page.locator(guide.surface).evaluate(canvas => {
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let count = 0; for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) count++;
        return { count, corners: [pixels[3], pixels[(canvas.width - 1) * 4 + 3], pixels[(canvas.height - 1) * canvas.width * 4 + 3]] };
      });
      assert.ok(painted.count > 10000);
      assert.ok(painted.corners.every(alpha => alpha === 0), 'remove the original rectangular background');
      for (const label of ['开心', '好奇', '关切']) {
        await choice(page, 'emotion', label); await page.waitForTimeout(120);
        assert.equal(neutral.equals(await page.locator(guide.surface).screenshot()), false, `${guide.id}/${label} changes the actual rendered pixels`);
      }
      await choice(page, 'emotion', '自然');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await choice(page, 'action', '行走');
      const before = await readMotion(page); await page.waitForTimeout(400); const after = await readMotion(page);
      assert.ok(Math.abs(after.x - before.x) > 5, 'walking has real displacement');
      assert.equal(after.moving, 'true'); assert.equal(after.action, 'walk');
      assert.ok(after.height <= 211);
      await page.locator('#companion-pet').focus(); await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(100); const placed = await readMotion(page);
      await page.waitForTimeout(250); const stable = await readMotion(page);
      assert.ok(Math.abs(stable.x - placed.x) < 1 && Math.abs(stable.y - placed.y) < 1);
      assert.equal(stable.moving, 'false'); assert.equal(stable.action, 'idle');
      for (const label of ['招手', '指景', '自然']) { await choice(page, 'action', label); await page.waitForTimeout(120); }
      await page.screenshot({ path: new URL(`${viewport.width}-${guide.id}-page.png`, output).pathname });
      results.push({ viewport, guide: guide.id, preservedChoices: 12, painted, displacement: after.x - before.x, dragStops: true, expressions: true, actions: true });
    }
    assert.deepEqual(errors, [], 'no browser errors');
    await page.close();
  }

  // Use the actual browser decoders and exact same renderers for a large,
  // deterministic close-up, including listening and speaking frames.
  const page = await browser.newPage({ viewport: { width: 880, height: 620 }, deviceScaleFactor: 1 });
  await page.goto(`${process.env.DEMO_URL || 'http://127.0.0.1:5173'}/tour.html`);
  await page.evaluate(async () => {
    const { createWatercolorOtter, createFeltDandelion } = await import('/src/components/reference-art-avatar.js');
    const review = document.createElement('div'); review.id = 'animal-art-review';
    review.style.cssText = 'position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;gap:30px;background:#faf5e9;color:#70583b;font:18px serif';
    document.body.append(review); window.artReviewModels = [];
    for (const [label, create] of [['水彩水獭 · 原画骨骼', createWatercolorOtter], ['毛毡蒲公英 · 原画图集', createFeltDandelion]]) {
      const figure = document.createElement('figure'); figure.style.cssText = 'margin:0;text-align:center';
      const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:360px;height:480px;display:block';
      const caption = document.createElement('figcaption'); caption.textContent = label; caption.style.marginTop = '14px';
      figure.append(canvas, caption); review.append(figure);
      const model = await create(canvas); model.draw({ time: 0, emotion: 'neutral' }); window.artReviewModels.push(model);
    }
  });
  await page.locator('#animal-art-review').screenshot({ path: new URL('reference-art-preview.png', output).pathname });
  for (const [name, parameters] of [['listening', { time: 1, listen: true, emotion: 'curious' }], ['speaking', { time: 1.1, talk: true, emotion: 'happy' }], ['wave', { time: 1, action: 'wave' }], ['walk', { time: .2, walk: true }]]) {
    await page.evaluate(parameters => window.artReviewModels.forEach(model => model.draw(parameters)), parameters);
    await page.locator('#animal-art-review').screenshot({ path: new URL(`reference-art-${name}.png`, output).pathname });
  }
  await page.evaluate(() => window.artReviewModels.forEach(model => model.dispose())); await page.close();
  await writeFile(new URL('browser-results.json', output), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify({ checks: results, preview: new URL('reference-art-preview.png', output).pathname }));
} finally { await browser.close(); }
