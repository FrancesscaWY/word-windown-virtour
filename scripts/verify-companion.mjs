import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const GUIDES = [
  { id: 'fox-2d', name: '小旅', label: '原创狐狸 · 2D', surface: '#companion-fox-2d', original: true, svg: true },
  { id: 'fox-3d', name: '小旅', label: '原创狐狸 · 3D', surface: '#companion-fox-3d', original: true },
  { id: 'explorer-2d', name: '星遥', label: '原创人形 · 2D', surface: '#companion-explorer-2d', original: true, svg: true },
  { id: 'explorer-3d', name: '星遥', label: '原创人形 · 3D', surface: '#companion-explorer-3d', original: true },
  { id: 'otter-watercolor', name: '沐沐', label: '水彩原画 · 分层骨骼', surface: '#companion-otter-watercolor', original: true, referenceArt: true },
  { id: 'dandelion-felt', name: '绒绒', label: '毛毡原画 · 预渲染', surface: '#companion-dandelion-felt', original: true, referenceArt: true },
  { id: 'otter-2d', name: '沐沐', label: '水獭探险家 · 2D', surface: '#companion-otter-2d', original: true, svg: true },
  { id: 'otter-3d', name: '沐沐', label: '水獭探险家 · 3D', surface: '#companion-otter-3d', original: true },
  { id: 'dandelion-2d', name: '绒绒', label: '蒲公英旅行家 · 2D', surface: '#companion-dandelion-2d', original: true, svg: true },
  { id: 'dandelion-3d', name: '绒绒', label: '蒲公英旅行家 · 3D', surface: '#companion-dandelion-3d', original: true },
  { id: '2d', name: '汪可', label: 'Wanko · 2D', surface: '#companion-2d-canvas' },
  { id: '3d', name: '赤狐', label: '官方赤狐 · 3D', surface: '#companion-3d' },
];
const EMOTIONS = ['自动', '自然', '开心', '好奇', '关切'];
const petRect = page => page.locator('#companion-pet').evaluate(element => element.getBoundingClientRect().toJSON());
const dockRect = page => page.locator('.voice-dock').evaluate(element => element.getBoundingClientRect().toJSON());

async function waitForGuide(page, mode) {
  await page.waitForFunction(expected => {
    const pet = document.querySelector('#companion-pet');
    return pet?.dataset.mode === expected && pet.getAttribute('aria-busy') === 'false';
  }, mode);
  // The selection completes before the next frame paints the new surface.
  await page.waitForTimeout(100);
}

async function assertGuide(page, guide) {
  const identity = await page.evaluate(() => ({
    selected: [...document.querySelectorAll('[data-avatar-mode][aria-pressed="true"]')].map(option => option.dataset.avatarMode),
    optionSelected: [...document.querySelectorAll('[data-avatar-mode][aria-selected="true"]')].map(option => option.dataset.avatarMode),
    mode: document.querySelector('#companion-pet')?.dataset.mode,
    name: document.querySelector('.guide-name strong')?.textContent,
    trigger: document.querySelector('#companion-guide')?.textContent,
    placeholder: document.querySelector('#voice-input')?.placeholder,
    replay: document.querySelector('#replay-guide')?.getAttribute('aria-label'),
  }));
  const placeholderMatches = identity.placeholder?.includes(guide.name) || ['我在听…', '陪聊中 · 随时可以暂停'].includes(identity.placeholder);
  const replayMatches = identity.replay === `重听${guide.name}的话` || ['打断讲解', '打断讲解，我来说', '停止讲解'].includes(identity.replay);
  if (identity.selected.join() !== guide.id || identity.optionSelected.join() !== guide.id || identity.mode !== guide.id || identity.name !== guide.name || !identity.trigger?.includes(guide.name) || !placeholderMatches || !replayMatches) throw new Error(`Guide identity mismatch: ${JSON.stringify({ guide: guide.id, ...identity })}`);
}

async function assertSurface(page, guide) {
  const surface = await page.locator(guide.surface).evaluate((element, selectors) => {
    const svg = element.querySelector('svg'); const viewBox = svg?.viewBox.baseVal;
    return {
      hidden: element.hidden, tag: element.tagName.toLowerCase(),
      active: selectors.filter(selector => !document.querySelector(selector).hidden),
      width: svg ? viewBox.width : element.width, height: svg ? viewBox.height : element.height,
      bones: svg?.querySelectorAll('[data-bone]').length ?? 0,
    };
  }, GUIDES.map(item => item.surface));
  if (surface.hidden || surface.active.join() !== guide.surface || surface.width < 20 || surface.height < 20 || (guide.svg ? surface.tag !== 'span' || surface.bones < 8 : surface.tag !== 'canvas')) throw new Error(`Missing or wrong guide surface: ${JSON.stringify({ guide: guide.id, ...surface })}`);
  // Three.js surfaces preserve their drawing buffer. Wanko's Pixi renderer
  // does not, so its displayed frames are checked through screenshots below.
  if (!guide.svg && guide.id !== '2d' && await page.locator('#companion-pet').isVisible()) {
    const paintedPixels = await page.locator(guide.surface).evaluate(canvas => {
      const snapshot = document.createElement('canvas'); snapshot.width = canvas.width; snapshot.height = canvas.height;
      const context = snapshot.getContext('2d'); context.drawImage(canvas, 0, 0);
      const rgba = context.getImageData(0, 0, snapshot.width, snapshot.height).data;
      let count = 0; for (let index = 3; index < rgba.length; index += 4) if (rgba[index] > 0) count++;
      return count;
    });
    if (paintedPixels < 100) throw new Error(`${guide.id} canvas has no visible character pixels`);
  }
  return surface;
}

async function openMenu(page, id) {
  const trigger = page.locator(`#companion-${id}`); const before = await dockRect(page);
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  const list = page.locator(`#companion-${id}-options`); await list.waitFor({ state: 'visible' });
  const geometry = await list.evaluate((element, menuId) => {
    const box = element.getBoundingClientRect();
    const anchor = document.querySelector(`#companion-${menuId}`).getBoundingClientRect();
    const app = document.querySelector('#app').getBoundingClientRect();
    return { expanded: document.querySelector(`#companion-${menuId}`).getAttribute('aria-expanded'), menu: box.toJSON(), anchor: anchor.toJSON(), app: app.toJSON(), width: innerWidth, height: innerHeight };
  }, id);
  const { menu, anchor, app } = geometry;
  if (geometry.expanded !== 'true' || menu.bottom > anchor.top + 1 || menu.left < Math.max(0, app.left) - 1 || menu.right > Math.min(geometry.width, app.right) + 1 || menu.top < Math.max(0, app.top) - 1 || menu.bottom > Math.min(geometry.height, app.bottom) + 1) throw new Error(`Menu does not open upward inside the viewport: ${JSON.stringify(geometry)}`);
  const options = list.getByRole('option'); let enabledCount = 0;
  for (let index = 0; index < await options.count(); index++) {
    const option = options.nth(index);
    if (await option.isDisabled()) continue;
    enabledCount++; await option.scrollIntoViewIfNeeded();
    const hit = await option.evaluate(element => {
      const rect = element.getBoundingClientRect(); const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { label: element.textContent, receivesPointer: !!target && element.contains(target), target: target?.id || target?.className || target?.tagName };
    });
    if (!hit.receivesPointer) throw new Error(`Menu option is clipped or blocked: ${JSON.stringify(hit)}`);
  }
  if (enabledCount < 2) throw new Error(`${id} menu has fewer than two usable choices`);
  const after = await dockRect(page);
  if (['x', 'y', 'width', 'height'].some(key => Math.abs(before[key] - after[key]) > 1)) throw new Error(`Opening a menu changed the bottom rail: ${JSON.stringify({ before, after })}`);
}

async function assertMenuClosed(page, id, restoreFocus = true) {
  await page.locator(`#companion-${id}-options`).waitFor({ state: 'hidden' });
  const state = await page.locator(`#companion-${id}`).evaluate(element => ({ expanded: element.getAttribute('aria-expanded'), focused: document.activeElement === element }));
  if (state.expanded !== 'false' || (restoreFocus && !state.focused)) throw new Error(`Menu did not close and restore focus: ${JSON.stringify({ id, ...state })}`);
}

async function choose(page, id, label) {
  await openMenu(page, id);
  await page.locator(`#companion-${id}-options`).getByRole('option', { name: label, exact: true }).click();
  await assertMenuClosed(page, id);
}

async function chooseGuide(page, guide) {
  await openMenu(page, 'guide'); await page.locator(`[data-avatar-mode="${guide.id}"]`).click();
  await assertMenuClosed(page, 'guide'); await waitForGuide(page, guide.id); await assertGuide(page, guide);
}

async function assertGuideChoices(page) {
  await openMenu(page, 'guide');
  const choices = await page.locator('#companion-guide-options [data-avatar-mode]').evaluateAll(elements => elements.map(element => ({ id: element.dataset.avatarMode, label: element.querySelector('small')?.textContent, disabled: element.disabled })));
  if (choices.length !== GUIDES.length || choices.some((choice, index) => choice.id !== GUIDES[index].id || choice.label !== GUIDES[index].label || choice.disabled)) throw new Error(`Wrong guide choices: ${JSON.stringify(choices)}`);
  await page.keyboard.press('Escape'); await assertMenuClosed(page, 'guide');
}

async function assertFocusedGuide(page, guide) {
  const state = await page.locator('#companion-guide-options').evaluate(list => {
    const option = document.activeElement; const menu = list.getBoundingClientRect(); const box = option.getBoundingClientRect();
    return { id: option.dataset.avatarMode, inList: list.contains(option), disabled: option.disabled, scrollTop: list.scrollTop, scrollHeight: list.scrollHeight, clientHeight: list.clientHeight, fullyVisible: box.top >= menu.top - 1 && box.bottom <= menu.bottom + 1 && box.left >= menu.left - 1 && box.right <= menu.right + 1 };
  });
  if (state.id !== guide.id || !state.inList || state.disabled || !state.fullyVisible) throw new Error(`Keyboard did not reveal the expected guide: ${JSON.stringify({ expected: guide.id, ...state })}`);
  return state;
}

async function assertGuideListNavigation(page) {
  const trigger = page.locator('#companion-guide');
  const first = GUIDES[0]; const last = GUIDES.at(-1);
  await trigger.focus(); await trigger.press('ArrowDown');
  await page.locator('#companion-guide-options').waitFor({ state: 'visible' });
  // openMenu() scrolls every hit target into view; use real keys here so that
  // those pointer checks cannot conceal a broken keyboard scroll handler.
  await page.keyboard.press('Home'); const home = await assertFocusedGuide(page, first);
  if (home.scrollHeight <= home.clientHeight + 1) throw new Error(`The ten-guide list is not constrained to a scrollable menu: ${JSON.stringify(home)}`);
  await page.keyboard.press('End'); const end = await assertFocusedGuide(page, last);
  if (end.scrollTop <= home.scrollTop + 1) throw new Error(`End focused the last guide without scrolling the menu: ${JSON.stringify({ home, end })}`);
  await page.keyboard.press('ArrowUp'); await assertFocusedGuide(page, GUIDES.at(-2));
  await page.keyboard.press('ArrowDown'); await assertFocusedGuide(page, last);
  await page.keyboard.press('ArrowDown'); await assertFocusedGuide(page, first);
  await page.keyboard.press('ArrowUp'); await assertFocusedGuide(page, last);
  await page.keyboard.press('Enter'); await assertMenuClosed(page, 'guide');
  await waitForGuide(page, last.id); await assertGuide(page, last);

  await chooseGuide(page, first); await openMenu(page, 'guide');
  // The final real click must still reach the bottom item after menu scrolling.
  await page.locator(`[data-avatar-mode="${last.id}"]`).click();
  await assertMenuClosed(page, 'guide'); await waitForGuide(page, last.id); await assertGuide(page, last);
  return { count: GUIDES.length, scrollable: true, keyboardEndSelection: true, lastItemClick: true };
}

async function assertEmotionChoices(page, guide) {
  if (!await page.locator('#companion-emotion').isVisible()) throw new Error(`${guide.id} has no visible expression control`);
  await openMenu(page, 'emotion');
  const choices = await page.locator('#companion-emotion-options [role="option"]').evaluateAll(elements => elements.map(element => ({ label: element.textContent, disabled: element.disabled, ariaDisabled: element.getAttribute('aria-disabled') })));
  if (choices.length !== EMOTIONS.length || choices.some((choice, index) => choice.label !== EMOTIONS[index] || choice.disabled !== (!guide.original && index > 1) || (choice.disabled && choice.ariaDisabled !== 'true'))) throw new Error(`Wrong expression support: ${JSON.stringify({ guide: guide.id, choices })}`);
  await page.keyboard.press('End');
  const focused = await page.evaluate(() => ({ label: document.activeElement?.textContent, disabled: document.activeElement?.disabled }));
  if (focused.disabled || focused.label !== (guide.original ? '关切' : '自然')) throw new Error(`Expression keyboard navigation reached an unavailable choice: ${JSON.stringify(focused)}`);
  await page.keyboard.press('Escape'); await assertMenuClosed(page, 'emotion');
}

async function assertEmotionRendering(page, guide, artifactPrefix) {
  if (!await page.locator('#companion-pet').isVisible()) return 'hidden for limited viewport space';
  // Reduced motion gives every frame the same time, so incidental blinks or
  // idle animation cannot make the expression image comparison pass.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  try {
    await choose(page, 'action', '自然'); await choose(page, 'emotion', '自然'); await page.waitForTimeout(120);
    const neutral = await page.locator(guide.surface).screenshot({ path: `artifacts/companion/${artifactPrefix}-${guide.id}-neutral.png` });
    const facialState = () => page.locator(`${guide.surface} svg`).evaluate(svg => Object.fromEntries(['eyes', 'brows', 'smile', 'mouth'].map(name => {
      const element = svg.querySelector(`[data-bone="${name}"]`);
      return [name, { d: element?.getAttribute('d'), transform: element?.getAttribute('transform'), opacity: element?.getAttribute('opacity') }];
    })));
    const neutralFace = guide.svg ? JSON.stringify(await facialState()) : null;
    for (const [value, label] of [['happy', '开心'], ['curious', '好奇'], ['concerned', '关切']]) {
      await choose(page, 'emotion', label);
      await page.waitForFunction(expected => document.querySelector('#companion-pet')?.dataset.emotion === expected, value);
      await page.waitForTimeout(120);
      const expression = await page.locator(guide.surface).screenshot(value === 'concerned' ? { path: `artifacts/companion/${artifactPrefix}-${guide.id}-concerned.png` } : {});
      if (neutral.equals(expression)) throw new Error(`${guide.id} ${label} does not change the rendered character`);
      if (guide.svg && neutralFace === JSON.stringify(await facialState())) throw new Error(`${guide.id} ${label} leaves all SVG facial joints unchanged`);
    }
    await choose(page, 'emotion', '自动');
  } finally { await page.emulateMedia({ reducedMotion: 'no-preference' }); }
  return true;
}

async function assertCompactLayout(page) {
  const layout = await page.evaluate(() => {
    const rect = selector => document.querySelector(selector)?.getBoundingClientRect().toJSON();
    const visible = element => !!(element.getBoundingClientRect().width && element.getBoundingClientRect().height);
    return {
      overflow: document.documentElement.scrollWidth > innerWidth,
      controls: rect('.companion-controls'), dock: rect('.voice-dock'), guide: rect('#companion-guide'), emotion: rect('#companion-emotion'), action: rect('#companion-action'), roam: rect('.companion-roam'),
      emotionVisible: visible(document.querySelector('#companion-emotion').closest('.companion-choice')),
      floatingPhotos: [...document.querySelectorAll('.map-photo-preview')].filter(visible).length,
      viewToggle: document.querySelectorAll('.map-view-toggle, button[data-map-view]').length,
      mapView: document.querySelector('.map-viewport')?.dataset.mapView,
      pet: rect('#companion-pet'), petHidden: document.querySelector('#companion-pet').hidden,
      stage: rect('.scene-surface'), facilities: rect('.facility-filters'),
    };
  });
  const row = [layout.guide, layout.emotion, layout.action, layout.roam]; const centers = row.map(rect => rect.top + rect.height / 2);
  if (layout.overflow || !layout.emotionVisible || layout.floatingPhotos || layout.controls.height > 54 || Math.max(...centers) - Math.min(...centers) > 1 || row.some(rect => rect.width < 24 || rect.left < layout.dock.left - 1 || rect.right > layout.dock.right + 1)) throw new Error(`Bottom rail is not compact: ${JSON.stringify(layout)}`);
  if (layout.viewToggle || layout.mapView !== 'relief') throw new Error(`Map no longer opens directly in relief: ${JSON.stringify(layout)}`);
  if (!layout.petHidden && layout.pet.bottom > layout.dock.top + 2) throw new Error(`Pet overlaps bottom rail: ${JSON.stringify(layout)}`);
  if (!layout.petHidden) {
    const floor = layout.facilities?.height ? layout.facilities.top - 8 : layout.stage.bottom - 18;
    if (layout.pet.height > 211 || layout.pet.left < layout.stage.left + 11 || layout.pet.right > layout.stage.right - 11 || layout.pet.top < layout.stage.top + 54 || layout.pet.bottom > floor + 1) throw new Error(`Pet scale or position obscures the map controls: ${JSON.stringify(layout)}`);
  }
  return layout;
}

async function assertVoiceAffordance(page) {
  const voice = await page.evaluate(() => {
    const button = document.querySelector('#speech-button'); const hint = document.querySelector('#voice-hint');
    return { label: button.getAttribute('aria-label'), state: button.dataset.voiceState, listening: button.dataset.listening, busy: button.getAttribute('aria-busy'), describedBy: button.getAttribute('aria-describedby'), hint: hint.textContent, hintState: hint.dataset.voiceState, hintHidden: hint.hidden };
  });
  const labels = { requesting: '暂停聆听', listening: '暂停聆听', processing: '暂停聆听', waiting: '暂停聆听', speaking: '打断讲解', paused: '继续聆听', error: '重试聆听' };
  if (voice.label !== labels[voice.state] || voice.hintState !== voice.state || voice.describedBy !== 'voice-hint' || voice.hintHidden || !voice.hint.trim() || voice.listening !== String(voice.state === 'listening') || voice.busy !== String(voice.state === 'requesting')) throw new Error(`Voice state and visible hint disagree: ${JSON.stringify(voice)}`);
  return voice;
}

function assertPositionStable(before, after, label) {
  if (Math.abs(before.left - after.left) > 1 || Math.abs(before.top - after.top) > 1) throw new Error(`${label}: ${JSON.stringify({ before, after })}`);
}

async function motionSnapshot(page) {
  return page.evaluate(() => {
    const pet = document.querySelector('#companion-pet');
    const stage = document.querySelector('.scene-surface').getBoundingClientRect();
    const toolbar = document.querySelector('.facility-filters').getBoundingClientRect();
    const box = pet.getBoundingClientRect();
    return {
      rect: box.toJSON(), moving: pet.dataset.moving, action: pet.dataset.motionAction,
      roaming: document.querySelector('#companion-roam').checked,
      selectedAction: document.querySelector('#companion-action [data-choice-value]').textContent,
      limits: { left: stage.left + 12, right: stage.right - 12, top: stage.top + 55, bottom: toolbar.height ? toolbar.top - 8 : stage.bottom - 18 },
    };
  });
}

function assertMotionBounds(sample, guide) {
  const { rect, limits } = sample;
  if (rect.height > 211 || rect.left < limits.left - 1 || rect.right > limits.right + 1 || rect.top < limits.top - 1 || rect.bottom > limits.bottom + 1) throw new Error(`${guide.id} walking exceeded its size or facility-safe bounds: ${JSON.stringify(sample)}`);
}

async function sampleWalking(page, guide) {
  await page.waitForFunction(() => {
    const pet = document.querySelector('#companion-pet');
    return pet?.dataset.moving === 'true' && pet.dataset.motionAction === 'walk';
  });
  const samples = [];
  for (let index = 0; index < 8; index++) {
    await page.waitForTimeout(90);
    const sample = await motionSnapshot(page); samples.push(sample);
    assertMotionBounds(sample, guide);
    if (sample.roaming || sample.moving !== 'true' || sample.action !== 'walk') throw new Error(`${guide.id} manual walking did not produce an active gait with roaming disabled: ${JSON.stringify(sample)}`);
  }
  const range = Math.max(...samples.map(sample => sample.rect.left)) - Math.min(...samples.map(sample => sample.rect.left));
  if (range < 5) throw new Error(`${guide.id} animated walking in place: ${JSON.stringify(samples)}`);
  if (samples.some(sample => Math.abs(sample.rect.top - samples[0].rect.top) > 1)) throw new Error(`${guide.id} horizontal walking changed the manually selected height: ${JSON.stringify(samples)}`);
  return { displacementRange: range, samples };
}

async function assertLocomotion(page, guide) {
  const walkingChoice = page.locator('#companion-action-options').getByRole('option', { name: '行走', exact: true, includeHidden: true });
  if (guide.id === '2d') {
    if (await walkingChoice.count()) throw new Error('Wanko exposes a walking animation absent from its sample assets');
    return 'official Wanko sample has no walking clip';
  }
  if (!await walkingChoice.count() || await walkingChoice.isDisabled()) throw new Error(`${guide.id} lost its supported walking action`);
  if (!await page.locator('#companion-pet').isVisible()) return 'hidden for limited viewport space';
  // Expression checks deliberately freeze time; real movement checks must
  // explicitly restore normal motion before sampling screen coordinates.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await choose(page, 'action', '自然'); await page.locator('#companion-roam').uncheck();
  await choose(page, 'action', '行走'); const first = await sampleWalking(page, guide);

  await choose(page, 'action', '自然'); await page.waitForTimeout(100);
  const stopped = await motionSnapshot(page); await page.waitForTimeout(350);
  const still = await motionSnapshot(page);
  assertPositionStable(stopped.rect, still.rect, `${guide.id} kept moving after selecting natural`);
  if (still.moving !== 'false' || still.action !== 'idle') throw new Error(`${guide.id} kept its gait after stopping: ${JSON.stringify(still)}`);

  // Place while walking, so this also verifies that keyboard placement
  // cancels an explicit patrol instead of immediately snapping back into it.
  await choose(page, 'action', '行走'); await sampleWalking(page, guide);
  const beforePlace = await motionSnapshot(page);
  const key = beforePlace.rect.left + beforePlace.rect.width / 2 < (beforePlace.limits.left + beforePlace.limits.right) / 2 ? 'ArrowRight' : 'ArrowLeft';
  await page.locator('#companion-pet').focus(); await page.keyboard.press(key); await page.waitForTimeout(100);
  const placed = await motionSnapshot(page); assertMotionBounds(placed, guide);
  if (placed.roaming || placed.moving !== 'false' || placed.action !== 'idle' || placed.selectedAction !== '自然') throw new Error(`${guide.id} keyboard placement did not stop at the dropped position: ${JSON.stringify(placed)}`);
  await page.waitForTimeout(350);
  assertPositionStable(placed.rect, (await motionSnapshot(page)).rect, `${guide.id} lost its keyboard placement`);

  await choose(page, 'action', '行走'); const resumed = await sampleWalking(page, guide);
  if (Math.abs(resumed.samples[0].rect.top - placed.rect.top) > 1) throw new Error(`${guide.id} resumed walking by resetting the placed height`);
  await choose(page, 'action', '自然');
  return { manualDisplacement: first.displacementRange, resumesAfterPlacement: resumed.displacementRange, idleStops: true, boundsAndScale: true };
}

async function assertDragging(page) {
  const pet = page.locator('#companion-pet');
  if (!await pet.isVisible()) return 'hidden for limited viewport space';
  await choose(page, 'action', '自然'); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#companion-roam').check(); await page.waitForTimeout(120);
  await page.evaluate(() => {
    window.__companionReplayClicks = 0;
    document.querySelector('#companion-pet').addEventListener('click', () => { window.__companionReplayClicks++; });
  });
  const before = await petRect(page);
  const stage = await page.locator('.scene-surface').evaluate(element => element.getBoundingClientRect().toJSON());
  const dx = before.left + before.width / 2 < stage.left + stage.width / 2 ? 48 : -48;
  const dy = Math.max(-40, stage.top + 55 - before.top);
  const start = { x: before.left + before.width / 2, y: before.top + before.height / 2 };
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 6 });
  if (await pet.getAttribute('data-dragging') !== 'true') throw new Error('A real mouse drag never entered dragging state');
  await page.mouse.up();
  const dropped = await petRect(page);
  const dragState = await page.evaluate(() => ({ replayClicks: window.__companionReplayClicks, roaming: document.querySelector('#companion-roam').checked, dragging: document.querySelector('#companion-pet').dataset.dragging, status: document.querySelector('#companion-status').textContent }));
  if (Math.hypot(dropped.left - before.left, dropped.top - before.top) < 20 || dragState.roaming || dragState.dragging === 'true' || dragState.replayClicks !== 0 || !dragState.status.includes('已放在这里')) throw new Error(`Dragging did not place the guide without replay: ${JSON.stringify({ before, dropped, ...dragState })}`);
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.waitForTimeout(700);
  assertPositionStable(dropped, await petRect(page), 'Manually placed guide snapped back after waiting');
  await pet.click();
  if (await page.evaluate(() => window.__companionReplayClicks) !== 1) throw new Error('A light tap stopped reaching the guide replay handler after dragging');
  await page.waitForTimeout(120); assertPositionStable(dropped, await petRect(page), 'A light tap moved the manually placed guide');

  await pet.focus(); const keyStart = await petRect(page); await page.keyboard.press('ArrowRight');
  const sixteen = await petRect(page);
  if (Math.abs(sixteen.left - keyStart.left - 16) > 1) throw new Error('ArrowRight did not move the guide 16 pixels');
  await page.keyboard.press('Shift+ArrowLeft'); const thirtyTwo = await petRect(page);
  if (Math.abs(thirtyTwo.left - sixteen.left + 32) > 1) throw new Error('Shift+ArrowLeft did not move the guide 32 pixels');
  const limits = await page.evaluate(() => {
    const stage = document.querySelector('.scene-surface').getBoundingClientRect();
    const pet = document.querySelector('#companion-pet').getBoundingClientRect();
    const toolbar = document.querySelector('.facility-filters').getBoundingClientRect();
    return { left: stage.left + 12, right: stage.right - pet.width - 12, top: stage.top + 55, bottom: (toolbar.height ? toolbar.top - 8 : stage.bottom - 18) - pet.height, xSteps: Math.ceil(stage.width / 32) + 2, ySteps: Math.ceil(stage.height / 32) + 2 };
  });
  for (let index = 0; index < limits.xSteps; index++) await page.keyboard.press('Shift+ArrowLeft');
  for (let index = 0; index < limits.ySteps; index++) await page.keyboard.press('Shift+ArrowUp');
  const minimum = await petRect(page);
  if (Math.abs(minimum.left - limits.left) > 1 || Math.abs(minimum.top - limits.top) > 1) throw new Error(`Keyboard movement escaped the top/left bounds: ${JSON.stringify({ limits, minimum })}`);
  await page.keyboard.press('Shift+ArrowLeft'); await page.keyboard.press('Shift+ArrowUp');
  assertPositionStable(minimum, await petRect(page), 'Keyboard kept moving beyond the top/left limits');
  for (let index = 0; index < limits.xSteps; index++) await page.keyboard.press('Shift+ArrowRight');
  for (let index = 0; index < limits.ySteps; index++) await page.keyboard.press('Shift+ArrowDown');
  const maximum = await petRect(page);
  if (Math.abs(maximum.left - limits.right) > 1 || Math.abs(maximum.top - limits.bottom) > 1) throw new Error(`Keyboard movement escaped the bottom/right bounds: ${JSON.stringify({ limits, maximum })}`);
  await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('Shift+ArrowDown');
  assertPositionStable(maximum, await petRect(page), 'Keyboard kept moving beyond the bottom/right limits');
  return true;
}

await mkdir('artifacts/companion', { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 740 }, { width: 844, height: 390 }]) {
    const page = await browser.newPage({ viewport }); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(process.env.DEMO_URL || 'http://127.0.0.1:5173/tour.html');
    await waitForGuide(page, 'otter-watercolor'); await assertGuide(page, GUIDES.find(guide => guide.id === 'otter-watercolor'));
    const initialVoice = await assertVoiceAffordance(page);
    // Pause real capture when available so expression comparisons stay stable.
    if (initialVoice.label === '暂停聆听') await page.locator('#speech-button').click();
    await assertGuideChoices(page);
    const guideList = await assertGuideListNavigation(page);
    const artifactPrefix = `${viewport.width}x${viewport.height}`; const results = [];
    for (const guide of GUIDES) {
      await chooseGuide(page, guide); await assertCompactLayout(page); await assertEmotionChoices(page, guide);
      const surface = await assertSurface(page, guide); await choose(page, 'action', '自然');
      let expressions = 'official sample: auto and neutral only';
      if (guide.original) {
        expressions = await assertEmotionRendering(page, guide, artifactPrefix);
        for (const label of (guide.referenceArt ? ['行走', '招手', '指景', '自然'] : ['行走', '招手', '指景', '转向', '自然'])) await choose(page, 'action', label);
        if (guide.svg && await page.locator('#companion-pet').isVisible()) {
          await choose(page, 'action', '指景'); await page.waitForTimeout(100);
          if (await page.locator(`${guide.surface} [data-bone="armR"]`).getAttribute('transform') !== 'rotate(-90)') throw new Error(`${guide.id} pointing action did not reach its arm joint`);
          await choose(page, 'action', '自然');
        }
      } else {
        for (const label of ['自动', '自然']) await choose(page, 'emotion', label);
        for (const label of guide.id === '2d' ? ['互动', '自然'] : ['行走', '小跑', '转向', '自然']) await choose(page, 'action', label);
      }
      const locomotion = await assertLocomotion(page, guide);
      let animation = 'hidden for limited viewport space';
      if (!guide.svg && await page.locator('#companion-pet').isVisible()) {
        await choose(page, 'action', guide.id === '2d' ? '互动' : guide.referenceArt ? '招手' : '转向'); await page.waitForTimeout(150);
        const before = await page.locator(guide.surface).screenshot(); await page.waitForTimeout(350);
        if (before.equals(await page.locator(guide.surface).screenshot())) throw new Error(`${guide.id} animation is static`);
        animation = true; await choose(page, 'action', '自然');
      }
      await page.screenshot({ path: `artifacts/companion/${artifactPrefix}-${guide.id}.png` });
      results.push({ id: guide.id, surface, expressions, animation, locomotion });
    }

    await chooseGuide(page, GUIDES[0]); await choose(page, 'action', '招手'); await openMenu(page, 'emotion');
    if (await page.locator('#companion-pet').isVisible()) {
      const before = await page.locator(GUIDES[0].surface).screenshot(); await page.waitForTimeout(250);
      if (!before.equals(await page.locator(GUIDES[0].surface).screenshot())) throw new Error('Character animation continued while the expression menu was open');
    }
    await page.keyboard.press('Escape'); await assertMenuClosed(page, 'emotion');
    await openMenu(page, 'guide'); await page.keyboard.press('Escape'); await assertMenuClosed(page, 'guide');
    await openMenu(page, 'action'); await page.locator('.header-place').click(); await assertMenuClosed(page, 'action', false);
    const dragging = await assertDragging(page); const layout = await assertCompactLayout(page);
    const overlap = await page.evaluate(() => {
      const pet = document.querySelector('#companion-pet'); if (pet.hidden) return false;
      const a = pet.getBoundingClientRect(); const b = document.querySelector('.facility-filters').getBoundingClientRect();
      return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    });
    if (overlap) throw new Error('Pet overlaps facility toolbar');
    if (viewport.width === 1440) {
      await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(100);
      const position = await petRect(page);
      if (!await page.locator('#companion-pet').isVisible() || position.left < 0 || position.right > 390) throw new Error(`Pet escaped the viewport after resizing: ${JSON.stringify(position)}`);
      await assertCompactLayout(page); await openMenu(page, 'guide'); await page.keyboard.press('Escape'); await assertMenuClosed(page, 'guide');
    }
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(JSON.stringify({ viewport, guides: results, guideList, dragging, voice: initialVoice, menuStable: true, menuHitTargets: true, compactControls: true, reliefOnly: true, noFloatingPhotos: true, petHidden: layout.petHidden, errors }));
    await page.close();
  }
} finally { await browser.close(); }
