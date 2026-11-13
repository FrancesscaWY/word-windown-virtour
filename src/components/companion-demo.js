import { createLive2D } from './live2d-avatar.js';
import { createSampleAnimal3D } from './sample-animal-3d.js';
import { createExplorer2D, createExplorer3D } from './explorer-avatar.js';
import { createOriginalFox2D, createOriginalFox3D } from './original-fox-avatar.js';
import { createOtter2D, createOtter3D } from './otter-avatar.js';
import { createDandelion2D, createDandelion3D } from './dandelion-avatar.js';
import { createWatercolorOtter, createFeltDandelion } from './reference-art-avatar.js';
import { clampCompanionPosition, mountCompanionDrag } from './companion-drag.js';
import { advanceCompanionMotion, companionSize } from './companion-motion.js';
import { icon } from './icons.js';

export const GUIDES = Object.freeze({
  'otter-watercolor': { name: '沐沐', label: '水彩原画 · 分层骨骼', tech: '水彩', surface: 'companion-otter-watercolor', create: createWatercolorOtter },
  'dandelion-felt': { name: '绒绒', label: '毛毡原画 · 预渲染', tech: '毛毡', surface: 'companion-dandelion-felt', create: createFeltDandelion },
  'fox-2d': { name: '小旅', label: '原创狐狸 · 2D', tech: '2D', surface: 'companion-fox-2d', create: createOriginalFox2D },
  'fox-3d': { name: '小旅', label: '原创狐狸 · 3D', tech: '3D', surface: 'companion-fox-3d', create: createOriginalFox3D },
  'explorer-2d': { name: '星遥', label: '原创人形 · 2D', tech: '2D', surface: 'companion-explorer-2d', create: createExplorer2D },
  'explorer-3d': { name: '星遥', label: '原创人形 · 3D', tech: '3D', surface: 'companion-explorer-3d', create: createExplorer3D },
  'otter-2d': { name: '沐沐', label: '水獭探险家 · 2D', tech: '2D', surface: 'companion-otter-2d', create: createOtter2D },
  'otter-3d': { name: '沐沐', label: '水獭探险家 · 3D', tech: '3D', surface: 'companion-otter-3d', create: createOtter3D },
  'dandelion-2d': { name: '绒绒', label: '蒲公英旅行家 · 2D', tech: '2D', surface: 'companion-dandelion-2d', create: createDandelion2D },
  'dandelion-3d': { name: '绒绒', label: '蒲公英旅行家 · 3D', tech: '3D', surface: 'companion-dandelion-3d', create: createDandelion3D },
  '2d': { name: '汪可', label: 'Wanko · 2D', tech: '2D', surface: 'companion-2d-canvas', create: createLive2D },
  '3d': { name: '赤狐', label: '官方赤狐 · 3D', tech: '3D', surface: 'companion-3d', create: createSampleAnimal3D },
});
export const DEFAULT_GUIDE = 'otter-watercolor';
const EMOTION_LABELS = { auto: '自动', neutral: '自然', happy: '开心', curious: '好奇', concerned: '关切' };
const ACTION_LABELS = { idle: '自然', walk: '行走', run: '小跑', wave: '招手', point: '指景', turn: '转向', tap: '互动' };

function menuMarkup(id, label, value = '') {
  const text = id === 'guide' ? `<span data-choice-value>${value}</span>` : `<span class="choice-label">${label}</span><span class="choice-selection"> · <span data-choice-value>${value}</span></span>`;
  return `<div class="companion-choice"><button type="button" id="companion-${id}" class="companion-choice-trigger" aria-label="${label}" aria-haspopup="listbox" aria-expanded="false" aria-controls="companion-${id}-options"><span>${text}</span>${icon('down')}</button><div id="companion-${id}-options" class="companion-options" role="listbox" aria-label="${label}" hidden></div></div>`;
}

export function companionMarkup() {
  const defaultGuide = GUIDES[DEFAULT_GUIDE];
  const surfaces = Object.entries(GUIDES).map(([id, guide]) => {
    const isSvg = guide.tech === '2D' && id !== '2d';
    const tag = isSvg ? 'span' : 'canvas';
    return `<${tag} id="${guide.surface}"${isSvg ? ' class="companion-surface"' : ''}${id === DEFAULT_GUIDE ? '' : ' hidden'} aria-label="${guide.name} · ${guide.label}"></${tag}>`;
  }).join('');
  return `<section class="companion-controls" aria-label="伴游设置">
    <span class="companion-route-status">${icon('compass')}<span><strong>自动伴游中</strong><small>沿途景点会主动讲解</small></span></span>
    <div class="companion-test-controls" hidden aria-hidden="true">
      ${menuMarkup('guide', '切换数字导游', `${defaultGuide.name} · ${defaultGuide.tech}`)}
      ${menuMarkup('emotion','表情')}${menuMarkup('action','动作')}
    </div>
    <label class="companion-roam" title="角色沿画面边缘自动移动，随所选景点调整停靠位置；拖动后停留原处。不追踪游客位置。"><input id="companion-roam" type="checkbox" aria-describedby="companion-roam-hint" checked/><span class="roam-switch" aria-hidden="true"></span><span>自动游走</span></label>
    <span id="companion-roam-hint" class="sr-only">角色沿画面边缘自动移动，随所选景点调整停靠位置；拖动后停留原处。不追踪游客位置。</span>
    <span id="companion-status" role="status" class="sr-only"></span>
  </section><button type="button" id="companion-pet" class="companion-pet" data-guide-name="${defaultGuide.name}" aria-label="${defaultGuide.name}，重听讲解" aria-describedby="companion-drag-hint" aria-busy="true">${surfaces}<span id="companion-loading" class="companion-loading">导游正在过来…</span></button><span id="companion-drag-hint" class="sr-only">可拖动到画面内任意位置；聚焦后可用方向键移动。轻点重听或打断讲解。</span>`;
}

export function mountCompanionDemo({ host, stage, store, onActivate }) {
  host.insertAdjacentHTML('beforeend', companionMarkup());
  const pet = host.querySelector('#companion-pet');
  // Keep the fixed character and menus in the same stacking context.
  host.closest('#app').append(pet);
  const surfaces = Object.fromEntries(Object.entries(GUIDES).map(([id, guide]) => [id, pet.querySelector(`#${guide.surface}`)]));
  const status = host.querySelector('#companion-status');
  const loading = pet.querySelector('#companion-loading');
  const portrait = host.querySelector('#replay-guide');
  portrait.querySelector('svg')?.remove();
  const thumbnail = document.createElement('img'); thumbnail.alt = ''; thumbnail.className = 'guide-animal-thumbnail'; portrait.prepend(thumbnail);
  const models = new Map(); const pending = new Map();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let mode = DEFAULT_GUIDE; let state = store.get(); let action = 'idle'; let emotion = 'auto'; let roaming = true;
  let disposed = false; let generation = 0; let frame; let last = 0; let started = performance.now(); let openMenu = null;
  let x = 0; let y = 0; let target = 0; let placed = false; let petHeight = 180; let bounds = { left: 0, right: 0, top: 0, bottom: 0 }; let lastPosition = ''; let needsPortrait = true;

  function syncGuideLabels() {
    const name = GUIDES[mode].name;
    const playing = ['speaking', 'preparing'].includes(state.guideStatus);
    host.querySelector('.guide-name strong').textContent = name;
    host.setAttribute('aria-label', `和${name}说说话`);
    host.querySelector('label[for="voice-input"]').textContent = `想去哪里，问问${name}`;
    const input = host.querySelector('#voice-input');
    const placeholder = state.guideStatus === 'listening' ? '我在听…' : state.voiceSession ? '陪聊中 · 随时可以暂停' : `想去哪里？问问${name}`;
    if (input.placeholder !== placeholder) input.placeholder = placeholder;
    portrait.setAttribute('aria-label', playing ? '打断讲解' : `重听${name}的话`);
    pet.dataset.guideName = name;
    pet.setAttribute('aria-label', playing ? `${name}，打断讲解` : `${name}，重听讲解`);
    const trigger = host.querySelector('#companion-guide');
    trigger.querySelector('[data-choice-value]').textContent = `${name} · ${GUIDES[mode].tech}`;
    trigger.setAttribute('aria-label', `切换数字导游，当前${name} ${GUIDES[mode].tech}`);
  }
  function closeMenus(restore = false) {
    const previous = openMenu; openMenu = null;
    host.querySelectorAll('.companion-options').forEach(el => { el.hidden = true; });
    host.querySelectorAll('.companion-choice-trigger').forEach(el => el.setAttribute('aria-expanded', 'false'));
    if (restore && previous) host.querySelector(`#companion-${previous}`)?.focus({ preventScroll: true });
  }
  function populateMenu(id, values, labels, selected, onSelect, supported = values) {
    const trigger = host.querySelector(`#companion-${id}`); const list = host.querySelector(`#companion-${id}-options`);
    trigger.querySelector('[data-choice-value]').textContent = labels[selected] ?? selected;
    trigger.setAttribute('aria-label', `${id === 'emotion' ? '表情' : '动作'} · ${labels[selected] ?? selected}`);
    trigger.disabled = values.length < 2;
    list.replaceChildren(...values.map(value => {
      const button = document.createElement('button'); button.type = 'button'; button.role = 'option'; button.textContent = labels[value] ?? value; button.setAttribute('aria-selected', String(selected === value));
      button.disabled = !supported.includes(value);
      if (button.disabled) { button.setAttribute('aria-disabled', 'true'); button.title = '当前模型未提供此表情，可切换小旅、星遥、沐沐或绒绒体验'; }
      button.addEventListener('click', () => { onSelect(value); closeMenus(true); }); return button;
    }));
  }
  function refreshChoices() {
    const caps = models.get(mode)?.capabilities ?? models.get(mode)?.metadata ?? {};
    const expressions = caps.expressions ?? caps.supportedExpressions ?? [];
    const expressionValues = Object.keys(EMOTION_LABELS);
    const supportedExpressions = ['auto', 'neutral', ...expressions];
    if (!supportedExpressions.includes(emotion)) emotion = 'auto';
    let actions = caps.actions ?? caps.supportedActions ?? ['idle'];
    if (!actions.length) actions = ['idle'];
    if (!actions.includes(action)) action = 'idle';
    populateMenu('emotion', expressionValues, EMOTION_LABELS, emotion, value => { emotion = value; refreshChoices(); }, supportedExpressions);
    if (!expressions.length && models.has(mode)) {
      const note = document.createElement('p'); note.className = 'companion-options-note'; note.textContent = '此示例未提供独立表情，切换小旅、星遥、沐沐或绒绒可体验。'; host.querySelector('#companion-emotion-options').append(note);
    }
    populateMenu('action', actions, ACTION_LABELS, action, value => { action = value; started = performance.now(); refreshChoices(); });
  }
  async function selectMode(next) {
    const token = ++generation; closeMenus(); pet.setAttribute('aria-busy', 'true'); loading.hidden = false;
    status.textContent = `正在请${GUIDES[next].name}过来`;
    try {
      if (!models.has(next)) {
        if (!pending.has(next)) pending.set(next, Promise.resolve().then(() => GUIDES[next].create(surfaces[next])));
        const model = await pending.get(next); pending.delete(next); if (disposed) { model.dispose(); return; } models.set(next, model);
      }
      if (disposed || token !== generation) return;
      mode = next; started = performance.now(); needsPortrait = true;
      Object.entries(surfaces).forEach(([key, surface]) => { surface.hidden = key !== mode; });
      host.querySelectorAll('[data-avatar-mode]').forEach(button => { const selected = String(button.dataset.avatarMode === mode); button.setAttribute('aria-pressed', selected); button.setAttribute('aria-selected', selected); });
      refreshChoices(); syncGuideLabels(); loading.hidden = true; pet.dataset.mode = mode; pet.dataset.emotion = emotion; status.textContent = `已切换${GUIDES[mode].name} ${GUIDES[mode].tech}`;
    } catch { pending.delete(next); if (token === generation && !disposed) { status.textContent = '导游暂时没加载出来，请再选一次'; loading.textContent = '导游暂时没到，再试一次'; } }
    finally { if (!disposed && token === generation) pet.setAttribute('aria-busy', 'false'); }
  }
  function dock() {
    const box = stage.getBoundingClientRect();
    const toolbar = stage.querySelector('.facility-filters')?.getBoundingClientRect(); const floor = toolbar?.height ? toolbar.top - 8 : box.bottom - 18;
    const companionAvailable = state.tourMode === 'companion' ? box.height - 24 : floor - box.top - 55;
    const { width, height } = companionSize({ viewportHeight: window.visualViewport?.height ?? innerHeight, stageWidth: box.width, availableHeight: companionAvailable });
    petHeight = height;
    pet.style.width = `${width}px`; pet.style.height = `${height}px`;
    // A short companion map has no room above its raised facility bar. Dock
    // beside that bar, while leaving the floating audio controls unobstructed.
    const sideDock = state.tourMode === 'companion' && toolbar?.height && floor - box.top - 55 < height + 12 && box.right - toolbar.right > width + 24;
    const safeLeft = sideDock ? toolbar.right + 12 : box.left + 12;
    const safeFloor = sideDock ? Math.min(box.bottom - 18, host.getBoundingClientRect().top - 12) : floor;
    bounds = { left: safeLeft, right: Math.max(safeLeft, box.right - width - 12), top: box.top + 55, bottom: Math.max(box.top + 55, safeFloor - height) };
    const selected = stage.querySelector('[data-poi].selected, [data-facility].selected');
    if (action === 'walk' || action === 'run') target = Math.max(bounds.left, Math.min(bounds.right, target));
    else if (roaming && !placed) target = selected && selected.getBoundingClientRect().left < box.left + box.width / 2 ? bounds.right : bounds.left;
    else target = x;
    if (!last) x = target;
    if (!placed) y = bounds.bottom;
    ({ x, y } = clampCompanionPosition({ x, y }, bounds));
    positionPet();
    pet.hidden = width < 64 || box.width < 240 || getComputedStyle(stage).visibility === 'hidden' || !!document.querySelector('dialog[open]');
  }
  function positionPet() {
    const position = `${x.toFixed(2)},${y.toFixed(2)}`;
    if (position !== lastPosition) { pet.style.left = `${x}px`; pet.style.top = `${y}px`; lastPosition = position; }
  }
  const guideList = host.querySelector('#companion-guide-options');
  for (const [id, guide] of Object.entries(GUIDES)) {
    const button = document.createElement('button'); button.type = 'button'; button.role = 'option'; button.dataset.avatarMode = id;
    button.setAttribute('aria-selected', String(id === mode)); button.setAttribute('aria-pressed', String(id === mode));
    button.innerHTML = `<span>${guide.name}</span><small>${guide.label}</small>${icon('check')}`;
    button.addEventListener('click', () => { closeMenus(true); void selectMode(id); }); guideList.append(button);
  }
  function focusOption(list, option) {
    if (!option) return;
    option.focus({ preventScroll: true });
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
  }
  for (const id of ['guide', 'emotion', 'action']) {
    const trigger = host.querySelector(`#companion-${id}`); const list = host.querySelector(`#companion-${id}-options`);
    const open = (edge = 'selected') => {
      closeMenus(); openMenu = id; list.hidden = false; trigger.setAttribute('aria-expanded', 'true');
      const box = list.getBoundingClientRect(); const viewport = host.getBoundingClientRect();
      const rightEdge = Math.min(innerWidth, viewport.right) - 8; const leftEdge = Math.max(0, viewport.left) + 8;
      const offset = Math.min(0, rightEdge - box.right) + Math.max(0, leftEdge - box.left);
      list.style.translate = `${offset}px 0`;
      const options = list.querySelectorAll('button:not(:disabled)');
      const option = edge === 'first' ? options[0] : edge === 'last' ? options[options.length - 1] : list.querySelector('[aria-selected="true"]');
      focusOption(list, option);
    };
    trigger.addEventListener('click', () => { if (openMenu === id) closeMenus(); else { list.style.translate = ''; open(); } });
    trigger.addEventListener('keydown', event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); list.style.translate = ''; open(event.key === 'ArrowDown' ? 'first' : 'last'); } });
    list.addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const options = [...list.querySelectorAll('button:not(:disabled)')]; const current = options.indexOf(document.activeElement);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      focusOption(list, options[index]);
    });
  }
  const outside = event => { if (!event.target.closest('.companion-choice')) closeMenus(); }; document.addEventListener('pointerdown', outside); document.addEventListener('focusin', outside);
  const keydown = event => { if (event.key === 'Escape' && openMenu) { event.preventDefault(); closeMenus(true); } }; document.addEventListener('keydown', keydown);
  host.querySelector('#companion-roam').addEventListener('change', event => { roaming = event.target.checked; if (roaming) placed = false; dock(); });
  const disposeDrag = mountCompanionDrag({
    element: pet,
    getPosition: () => ({ x, y, bounds }),
    onMove(position) { closeMenus(); placed = true; roaming = false; host.querySelector('#companion-roam').checked = false; if (action === 'walk' || action === 'run') { action = 'idle'; refreshChoices(); } ({ x, y } = position); target = x; positionPet(); },
    onPlace() { status.textContent = '导游已放在这里；选择行走或开启自动游走可继续移动'; },
  });
  pet.addEventListener('click', () => { if (!models.size) void selectMode(mode); else onActivate(); });
  const observer = new ResizeObserver(dock); observer.observe(stage); const modalObserver = new MutationObserver(dock); document.querySelectorAll('dialog').forEach(dialog => modalObserver.observe(dialog, { attributes: true, attributeFilter: ['open'] }));
  const resize = () => { closeMenus(); dock(); };
  const unsubscribe = store.subscribe(next => { state = next; syncGuideLabels(); dock(); }); window.addEventListener('resize', resize); window.addEventListener('scroll', dock, { passive: true });
  function tick(now) {
    if (disposed) return; frame = requestAnimationFrame(tick); if (document.hidden || openMenu || now - last < 1000 / 30) return; const dt = Math.min((now - last) / 1000 || .033, .1); last = now;
    const movement = advanceCompanionMotion({ x, target, bounds, action, roaming, placed, blocked: pet.hidden || state.detailsOpen || pet.dataset.dragging === 'true', reduced: reduced.matches, dt, height: petHeight });
    ({ x, target } = movement);
    pet.dataset.moving = String(movement.moving); pet.dataset.motionAction = movement.action;
    positionPet();
    if (pet.hidden || !models.has(mode)) return; const time = reduced.matches ? 1 : (now - started) / 1000;
    pet.dataset.emotion = emotion;
    const expressions = models.get(mode).capabilities?.expressions ?? [];
    const automaticEmotion = state.guideStatus === 'listening' ? 'curious' : state.guideStatus === 'speaking' ? 'happy' : 'neutral';
    models.get(mode).draw({ time, walk: movement.walk, run: movement.run, wave: action === 'wave', point: action === 'point', turn: action === 'turn' ? time * .65 : movement.moving ? movement.direction * .55 : 0, action: movement.action, emotion: emotion === 'auto' ? (expressions.includes(automaticEmotion) ? automaticEmotion : 'neutral') : emotion, talk: state.guideStatus === 'speaking', listen: state.guideStatus === 'listening' });
    if (needsPortrait && time > .15) {
      needsPortrait = false;
      try {
        const surface = surfaces[mode]; const svg = surface.querySelector('svg');
        thumbnail.src = svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}` : surface.toDataURL('image/png');
      } catch { thumbnail.removeAttribute('src'); }
    }
  }
  refreshChoices(); syncGuideLabels(); dock(); frame = requestAnimationFrame(tick); void selectMode(mode);
  return () => { disposed = true; generation++; cancelAnimationFrame(frame); disposeDrag(); observer.disconnect(); modalObserver.disconnect(); unsubscribe(); models.forEach(model => model.dispose()); pet.remove(); document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); document.removeEventListener('keydown', keydown); window.removeEventListener('resize', resize); window.removeEventListener('scroll', dock); };
}
