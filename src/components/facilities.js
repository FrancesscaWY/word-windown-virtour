import { escapeHTML as esc } from './html.js';
import { icon } from './icons.js';

const closeButton = id => `<button type="button" class="bubble-close" data-dismiss-bubble="${esc(id)}" aria-label="收起地点提示">${icon('close')}</button>`;
const sourceLink = item => `<a href="${esc(item.source)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(item.name)}，查看来源">${esc(item.name)}</a>`;

function bubbleMarkup(info) {
  const located = info.items.filter(item => item.position);
  if (located.length) return located.map(item => `<article class="map-bubble" data-bubble-id="${esc(item.id)}" aria-label="${esc(item.name)}"><header>${sourceLink(item)}${closeButton(item.id)}</header><p>${item.kind === 'gate' ? '通行待核实 · 认准现场指示' : '开放情况以现场为准'}</p></article>`).join('');
  return `<article class="map-bubble map-service-bubble" data-bubble-id="service" aria-label="服务地点，位置待核实"><header><span>服务地点 · 位置待核实</span>${closeButton('service')}</header><div class="map-service-items">${info.items.map(item => `<div class="map-service-item"><div>${sourceLink(item)}<small>${item.id === 'official-ticket-center' ? '前广场 · 票务咨询' : '休憩与购物 · 以现场为准'}</small></div>${item.phone ? `<a class="bubble-phone" href="tel:${esc(item.phone)}" aria-label="致电园区 0755-26608000" title="致电园区"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-5-2-2 2a14 14 0 0 1-7-7l2-2-2-5Z"/></svg></a>` : ''}</div>`).join('')}</div></article>`;
}

/** Unscaled map overlays. Located bubbles follow real pins; services follow their filter. */
export function mountFacilityBubbles(viewport, onDismiss) {
  const layer = viewport.querySelector('.map-bubbles');
  let entries = [];
  let kind = 'all';
  const rect = (node, origin) => {
    const r = node.getBoundingClientRect();
    return {x:r.left-origin.left, y:r.top-origin.top, width:r.width, height:r.height};
  };
  const overlaps = (a, b, gap = 6) => a.x < b.x+b.width+gap && a.x+a.width+gap > b.x && a.y < b.y+b.height+gap && a.y+a.height+gap > b.y;
  const refresh = () => {
    if (!layer || !entries.length || !viewport.clientWidth || !viewport.clientHeight) return;
    const origin = viewport.getBoundingClientRect();
    const obstacles = [...viewport.querySelectorAll('.map-controls, .catalog-trigger, .facility-filters, .map-caption')].map(node => rect(node, origin));
    const pins = entries.filter(entry => entry.anchor && !entry.anchor.hidden && !entry.service).map(entry => rect(entry.anchor, origin));
    for (const entry of entries) {
      const {bubble, anchor, leader, service} = entry;
      leader.style.display = 'none';
      if (!anchor || anchor.hidden) { bubble.hidden = true; continue; }
      const ar = rect(anchor, origin);
      const x = ar.x+ar.width/2;
      // Facility buttons include a label below the 28px pin. Keep the geographic
      // anchor stable while the icon bounces, rather than measuring its animation.
      const y = service ? ar.y : ar.y+14;
      if (x < 12 || x > origin.width-12 || y < 12 || y > origin.height-12) { bubble.hidden = true; continue; }
      bubble.hidden = false;
      const w = bubble.offsetWidth, h = bubble.offsetHeight;
      const clampX = value => Math.max(8, Math.min(origin.width-w-8, value));
      const clampY = value => Math.max(8, Math.min(origin.height-h-8, value));
      const gap = service ? 12 : 27;
      const candidates = [
        {x:clampX(x-w/2), y:y-gap-h},
        {x:x+ar.width/2+16, y:clampY(y-h/2)},
        {x:x-ar.width/2-16-w, y:clampY(y-h/2)},
        {x:clampX(x-w/2), y:ar.y+ar.height+8},
      ];
      // Corner alignments let two nearby gates retain separate, short bubbles.
      if (!service) for (const left of [x+12, x-w-12]) {
        candidates.push({x:clampX(left),y:y-gap-h}, {x:clampX(left),y:ar.y+ar.height+8});
      }
      // Small nudges fit between controls on short screens without detaching
      // information from its landmark or hiding an otherwise readable bubble.
      const nudges = [0, -4, 4, -8, 8, -16, 16, -32, 32];
      const adjusted = candidates.flatMap(p => nudges.flatMap(dx => nudges.map(dy => ({x:p.x+dx,y:p.y+dy}))));
      const position = [...candidates, ...adjusted].find(p => p.x >= 8 && p.y >= 8 && p.x+w <= origin.width-8 && p.y+h <= origin.height-8 && ![...obstacles, ...pins].some(block => overlaps({...p,width:w,height:h},block)));
      if (!position) { bubble.hidden = true; continue; }
      Object.assign(bubble.style, {left:`${position.x}px`,top:`${position.y}px`});
      obstacles.push({...position,width:w,height:h});
      const endX = Math.max(position.x+12, Math.min(position.x+w-12,x));
      const endY = Math.max(position.y+12, Math.min(position.y+h-12,y));
      const dx=endX-x, dy=endY-y, distance=Math.hypot(dx,dy);
      const inset=service ? 0 : 18;
      leader.setAttribute('d', `M ${x+dx/distance*inset} ${y+dy/distance*inset} L ${endX} ${endY}`);
      leader.style.display = '';
    }
  };
  const filterButton = () => viewport.ownerDocument.querySelector(`[data-top-facility-kind="${kind}"], [data-facility-kind="${kind}"]`);
  const focusFilter = () => filterButton()?.focus({preventScroll:true});
  const dismiss = () => {
    const button = filterButton() ?? viewport.ownerDocument.querySelector('[data-top-facility-kind="service"], [data-facility-kind="service"]');
    onDismiss(); button?.focus({preventScroll:true});
  };
  const click = event => {
    const id = event.target.closest('[data-dismiss-bubble]')?.dataset.dismissBubble;
    if (!id) return;
    const entry = entries.find(item => item.bubble.dataset.bubbleId === id);
    if (!entry) return;
    entry.bubble.remove(); entry.leader.remove(); entries = entries.filter(item => item !== entry);
    if (!entries.length) dismiss();
    else { entry.anchor.focus({preventScroll:true}); refresh(); }
  };
  layer?.addEventListener('click',click);
  return {
    refresh,
    dismiss,
    isOpen: () => entries.length > 0,
    show(info) {
      if (!layer) return;
      const hadFocus = layer.contains(viewport.ownerDocument.activeElement);
      if (hadFocus) focusFilter();
      kind = info?.kind ?? 'all';
      layer.innerHTML = info ? `<svg class="map-bubble-leaders" aria-hidden="true"></svg>${bubbleMarkup(info)}` : '';
      entries = [...layer.querySelectorAll('[data-bubble-id]')].map(bubble => {
        const service = bubble.dataset.bubbleId === 'service';
        const anchor = viewport.querySelector(service ? '.map-controls' : `[data-facility="${bubble.dataset.bubbleId}"]`);
        const leader = viewport.ownerDocument.createElementNS('http://www.w3.org/2000/svg','path');
        layer.querySelector('svg').append(leader);
        return {bubble, anchor, leader, service};
      });
      refresh();
    },
    destroy() { layer?.removeEventListener('click',click); layer?.replaceChildren(); entries=[]; },
  };
}
