export const DEFAULT_SCENE_SHARE = .4;

/** Keep both panes usable, including after a keyboard or viewport resize. */
export function sceneShareBounds(available, horizontal = false) {
  if (!Number.isFinite(available) || available <= 0) return { min: .25, max: .65 };
  const sceneMinimum = Math.min(horizontal ? 220 : 130, available * .4);
  const chatMinimum = Math.min(horizontal ? 300 : 200, available * .6);
  return { min: Math.max(.25, sceneMinimum / available), max: Math.min(.65, 1 - chatMinimum / available) };
}

export function clampSceneShare(value, available, horizontal = false) {
  const { min, max } = sceneShareBounds(available, horizontal);
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : DEFAULT_SCENE_SHARE));
}

/** Pointer, touch and keyboard resizing share the same ratio and bounds. */
export function mountWorkspaceResize({ app, store, scope = globalThis }) {
  const handle = app.querySelector('#workspace-divider');
  const scene = app.querySelector('.tour-workspace');
  const chat = app.querySelector('.voice-dock');
  const media = scope.matchMedia('(min-width: 900px), (min-width: 600px) and (max-height: 580px)');
  let share = DEFAULT_SCENE_SHARE, pointer = null;
  const geometry = () => {
    const a = scene.getBoundingClientRect(), b = chat.getBoundingClientRect(), bar = handle.getBoundingClientRect();
    return media.matches
      ? { start: a.left, available: b.right - a.left - bar.width, bar: bar.width }
      : { start: a.top, available: b.bottom - a.top - bar.height, bar: bar.height };
  };
  const paint = () => {
    const { available } = geometry();
    share = clampSceneShare(share, available, media.matches);
    app.style.setProperty('--scene-share', `${share}fr`);
    app.style.setProperty('--chat-share', `${1 - share}fr`);
    handle.setAttribute('aria-orientation', media.matches ? 'vertical' : 'horizontal');
    const bounds = sceneShareBounds(available, media.matches);
    handle.setAttribute('aria-valuemin', String(Math.round(bounds.min * 100)));
    handle.setAttribute('aria-valuemax', String(Math.round(bounds.max * 100)));
    handle.setAttribute('aria-valuenow', String(Math.round(share * 100)));
    handle.setAttribute('aria-valuetext', `画面 ${Math.round(share * 100)}%，对话 ${Math.round((1 - share) * 100)}%`);
  };
  const finish = event => {
    if (pointer === null || event && event.pointerId !== pointer) return;
    const previous = pointer; pointer = null; delete app.dataset.resizing;
    if (handle.hasPointerCapture?.(previous)) handle.releasePointerCapture(previous);
  };
  const down = event => {
    if (handle.hidden || event.isPrimary === false || event.button !== 0) return;
    pointer = event.pointerId; app.dataset.resizing = 'true';
    handle.focus({ preventScroll: true }); handle.setPointerCapture?.(pointer); event.preventDefault();
  };
  const move = event => {
    if (pointer === null || pointer !== event.pointerId) return;
    const { start, available, bar } = geometry();
    if (available <= 0) return;
    share = ((media.matches ? event.clientX : event.clientY) - start - bar / 2) / available;
    paint(); event.preventDefault();
  };
  const reset = () => { share = DEFAULT_SCENE_SHARE; paint(); };
  const key = event => {
    const decrease = media.matches ? 'ArrowLeft' : 'ArrowUp';
    const increase = media.matches ? 'ArrowRight' : 'ArrowDown';
    if (![decrease, increase, 'Home', 'End', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Enter') return reset();
    const bounds = sceneShareBounds(geometry().available, media.matches);
    share = event.key === 'Home' ? bounds.min : event.key === 'End' ? bounds.max : share + (event.key === increase ? 1 : -1) * (event.shiftKey ? .1 : .02);
    paint();
  };
  const update = () => {
    handle.hidden = app.dataset.workspace !== 'split';
    if (handle.hidden) finish();
    else paint();
  };
  const unsubscribe = store.subscribe(update);
  const observer = new scope.ResizeObserver(() => { if (!handle.hidden) paint(); });
  observer.observe(app.querySelector('.experience'));
  handle.title = '拖动调整，双击还原';
  for (const [name, fn] of [['pointerdown', down], ['pointermove', move], ['pointerup', finish], ['pointercancel', finish], ['lostpointercapture', finish], ['keydown', key], ['dblclick', reset]]) handle.addEventListener(name, fn);
  media.addEventListener('change', paint); scope.addEventListener('resize', paint); update();
  return () => {
    finish(); unsubscribe(); observer.disconnect();
    for (const [name, fn] of [['pointerdown', down], ['pointermove', move], ['pointerup', finish], ['pointercancel', finish], ['lostpointercapture', finish], ['keydown', key], ['dblclick', reset]]) handle.removeEventListener(name, fn);
    media.removeEventListener('change', paint); scope.removeEventListener('resize', paint);
    app.style.removeProperty('--scene-share'); app.style.removeProperty('--chat-share');
  };
}
