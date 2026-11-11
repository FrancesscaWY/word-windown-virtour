import { getPoi } from '../data/pois.js';
import { toMapPosition } from '../guide/location.js';

export const HOME_HINT = '想了解哪处风景？';
export const INTERACTIVE_GREETING = '我在听，想去哪里、想了解什么，都可以告诉我。';
export const COMPANION_GREETING = '即将带您开启伴游旅程，提醒您带好耳机，我们现在出发';

export function modeLayout(state) {
  if (state.tourMode === 'companion') return 'map';
  return state.tourMode === 'immersive' || state.interactionInput === 'text' ? 'split' : 'voice';
}

export function modeHint(state) {
  if (state.tourMode === 'immersive') return '打字和我聊聊';
  if (state.tourMode === 'companion') return state.companionPaused ? '伴游已暂停 · 可随时继续旅程' : COMPANION_GREETING;
  return state.interactionInput === 'text' ? '文字交流 · 语音已关闭' : INTERACTIVE_GREETING;
}

export function contextualPrompt(state) {
  const poi = getPoi(state.recommendedPoiIds?.[0]) ?? getPoi(state.mentionedPoiId ?? state.selectedPoiId) ?? getPoi('eiffel');
  return { poiId:poi.id, name:poi.name, label:`了解${poi.name}`, text:`介绍${poi.name}` };
}

/** Dismissal survives unrelated renders; a new explicit offer can be shown again. */
export function createRecommendationState() {
  let dismissed = null, target = null, offers = null;
  const update = state => {
    const prompt = contextualPrompt(state);
    if (target !== prompt.poiId || (state.recommendedPoiIds?.length && offers !== state.recommendedPoiIds)) dismissed = null;
    target = prompt.poiId; offers = state.recommendedPoiIds;
    return { ...prompt, hidden:dismissed === prompt.poiId };
  };
  return { update, dismiss(state) { const prompt = update(state); dismissed = prompt.poiId; return prompt.poiId; } };
}

/** A bounded trail is local to this visit. Source changes and GPS jumps start a new segment. */
export function createMovementTrail({ limit = 600 } = {}) {
  let segments = [], source = null;
  return {
    add(point, nextSource) {
      if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y) || point.x < 0 || point.x > 100 || point.y < 0 || point.y > 100) return false;
      if (source !== nextSource) { segments = []; source = nextSource; }
      let segment = segments.at(-1), last = segment?.at(-1);
      const distance = last ? Math.hypot(point.x - last.x, point.y - last.y) : 0;
      if (last && distance < .04) return false;
      if (!last || distance > 12) { segment = []; segments.push(segment); }
      segment.push({ x:point.x, y:point.y });
      while (segments.reduce((total, item) => total + item.length, 0) > limit) {
        segments[0].shift(); if (!segments[0].length) segments.shift();
      }
      return true;
    },
    paths:() => segments.map(segment => segment.map(({ x, y }, index) => `${index ? 'L' : 'M'}${x.toFixed(3)},${y.toFixed(3)}`).join(' ')),
    clear() { segments = []; source = null; },
  };
}

export function mountModeWorkspace({ app, store, onOpenRecommendation, onDismissRecommendation }) {
  const $ = selector => app.querySelector(selector);
  const trail = createMovementTrail();
  const recommendation = createRecommendationState();
  const layer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  layer.classList.add('movement-trail'); layer.setAttribute('viewBox', '0 0 100 100');
  layer.setAttribute('preserveAspectRatio', 'none'); layer.setAttribute('aria-hidden', 'true');
  $('.map-art').append(layer);
  let previous = {}, contentKey = '', trailKey = '';
  const renderTrail = () => {
    const paths = trail.paths(), key = paths.join('|');
    if (key === trailKey) return;
    trailKey = key;
    layer.replaceChildren(...paths.map(d => {
      const path = document.createElementNS(layer.namespaceURI, 'path');
      path.setAttribute('d', d); path.setAttribute('vector-effect', 'non-scaling-stroke'); return path;
    }));
  };
  const update = state => {
    const layout = modeLayout(state);
    app.dataset.workspace = layout;
    $('#conversation-panel').hidden = layout !== 'split';
    $('#conversation-mode-label').textContent = '与数字导游的对话';
    $('#conversation-hint').hidden = layout !== 'split';
    $('#conversation-hint').textContent = modeHint(state);
    const prompt = recommendation.update(state);
    $('#conversation-prompt-label').textContent = prompt.label;
    $('#conversation-recommendation').hidden = prompt.hidden || !state.recommendedPoiIds?.length;
    $('#conversation-prompt').setAttribute('aria-label', `前往${prompt.name}并展开解说`);
    if (state.tourMode !== previous.tourMode || state.visitorOriginSource !== previous.visitorOriginSource || !state.visitorOrigin) {
      trail.clear(); renderTrail();
    }
    if (state.tourMode === 'companion' && state.visitorOrigin && state.visitorOrigin !== previous.visitorOrigin) {
      const { x, y } = toMapPosition(state.visitorOrigin);
      if (trail.add({ x, y }, state.visitorOriginSource)) renderTrail();
    }
    const point = state.visitorOrigin ? toMapPosition(state.visitorOrigin) : null;
    const outside = point && (point.x < 0 || point.x > 100 || point.y < 0 || point.y > 100);
    const source = outside ? '当前位置不在园区地图内' : state.visitorOriginSource === '模拟定位' ? '模拟轨迹' : state.visitorOrigin ? '手机定位轨迹' : state.locationStatus || '等待定位';
    $('#trail-source').textContent = source;
    const isVoiceOpening = row => row.role !== 'user' && [INTERACTIVE_GREETING, COMPANION_GREETING].includes(row.text ?? row.content);
    const rows = [...(state.messages ?? [])].filter(row => !isVoiceOpening(row));
    if (!rows.length) rows.push({ role:'assistant', text:HOME_HINT });
    const key = JSON.stringify(rows);
    if (key !== contentKey) {
      contentKey = key;
      const log = $('#conversation-log');
      const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 50;
      log.replaceChildren(...rows.slice(-12).map(row => {
        const item = document.createElement('div'); item.className = `conversation-message ${row.role === 'user' ? 'from-visitor' : 'from-guide'}`;
        const label = document.createElement('span'); label.className = 'conversation-author'; label.textContent = row.role === 'user' ? '你' : '数字导游';
        const text = document.createElement('p'); text.textContent = row.text ?? row.content;
        label.classList.add('sr-only');
        item.append(label, text); return item;
      }));
      if (atBottom || state.messages?.at(-1)?.role === 'user') log.scrollTop = log.scrollHeight;
    }
    $('#guide-announcement').setAttribute('aria-live', layout === 'split' ? 'off' : 'polite');
    previous = { ...state };
  };
  const promptClick = () => onOpenRecommendation(contextualPrompt(store.get()).poiId);
  const dismissClick = () => {
    const id = recommendation.dismiss(store.get());
    $('#conversation-recommendation').hidden = true;
    onDismissRecommendation?.(id);
  };
  $('#conversation-prompt').addEventListener('click', promptClick);
  $('#conversation-dismiss').addEventListener('click', dismissClick);
  const unsubscribe = store.subscribe(update); update(store.get());
  return () => {
    unsubscribe(); layer.remove(); $('#conversation-prompt').removeEventListener('click', promptClick);
    $('#conversation-dismiss').removeEventListener('click', dismissClick);
  };
}
