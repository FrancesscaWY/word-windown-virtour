import { pois } from '../data/pois.js';
import { externalAssets } from '../data/external-assets.js';
import { facilities } from '../data/facilities.js';
import { mountFacilityBubbles } from './facilities.js';
import { landmark, facilityIcon } from './icons.js';
import { clampMapTransform, zoomMapAt, pinchMapTransform, MAP_LIMITS } from './map-controller.js';

/** Static OSM geometry and verified park anchors share one proportional layer. */
export function mapMarkup() {
  return `<div class="map-viewport" role="region" tabindex="0" aria-label="世界之窗园区地理地图，非实时导航" aria-describedby="map-help" data-facility-view="all" data-map-view="relief">
    <div class="map-art">
      <img class="map-base" src="${externalAssets.map.file}" alt="OpenStreetMap 世界之窗静态地理底图" draggable="false"/>
      ${pois.filter(poi => poi.position).map(poi => `<button type="button" class="map-poi ${poi.id === 'eiffel' ? 'selected' : ''}" style="--x:${poi.position.x}%;--y:${poi.position.y}%" data-poi="${poi.id}" aria-label="查看${poi.name}" aria-pressed="${poi.id === 'eiffel'}"><span class="map-poi-pin" aria-hidden="true">${landmark(poi.id)}</span><span class="map-poi-label">${poi.id === 'eiffel' ? '铁塔' : poi.name}</span></button>`).join('')}
      ${facilities.filter(item => item.position).map(item => `<button type="button" class="map-facility" style="--x:${item.position.x}%;--y:${item.position.y}%" data-facility="${item.id}" aria-label="${item.name}${item.kind === 'gate' ? '，通行待核实' : ''}" aria-pressed="false"><span class="facility-pin" aria-hidden="true">${facilityIcon(item.kind)}</span><span class="map-poi-label">${item.kind === 'gate' ? '园界门 · 待核实' : item.name}</span></button>`).join('')}
    </div>
    <div class="map-bubbles" aria-label="地图地点信息"></div>
    <div class="map-controls" role="group" aria-label="地图控制">
      <button type="button" class="map-control" data-map-action="zoom-in" aria-label="放大地图"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
      <output class="map-zoom" aria-label="地图缩放比例">100%</output>
      <button type="button" class="map-control" data-map-action="zoom-out" aria-label="缩小地图"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 12h14"/></svg></button>
      <span class="map-control-divider" aria-hidden="true"></span>
      <button type="button" class="map-control map-reset" data-map-action="reset" aria-label="看全园"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 3v4m0 10v4M3 12h4m10 0h4"/></svg><span>全园</span></button>
    </div>
    <span class="map-mood" aria-hidden="true">一张地图，环游世界<span>跟着好奇心出发</span></span>
    <p id="map-help" class="sr-only">绿色轮廓表示园区边界。拖动或双指缩放地图。键盘方向键平移，加减键缩放，Home 键复位。点击景点开始探索。</p>
    <span class="map-caption">${externalAssets.map ? '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>' : '示意地图'}</span>
  </div>`;
}

/** Returns cleanup(); cleanup.focusPoi(id) and cleanup.reset() are also available. */
export function mountMap(container, { onSelect = () => {}, onFacility = () => {}, onFacilityKind = () => {}, onDismissFacilities = () => {} } = {}) {
  const viewport = container.matches?.('.map-viewport') ? container : container.querySelector('.map-viewport');
  if (!viewport) throw new Error('Map viewport not found.');
  const art = viewport.querySelector('.map-art');
  if (!art) throw new Error('Map artwork not found.');
  const view = viewport.ownerDocument.defaultView;
  const controls = viewport.querySelector('.map-controls');
  const output = viewport.querySelector('.map-zoom');
  const mood = viewport.querySelector('.map-mood');
  const bubbles = mountFacilityBubbles(viewport, onDismissFacilities);
  const zoomIn = viewport.querySelector('[data-map-action="zoom-in"]');
  const zoomOut = viewport.querySelector('[data-map-action="zoom-out"]');
  const pointers = new Map(); const listeners = [];
  const home = { x: 0, y: 0, scale: 1 };
  let state = { ...home };
  let gesture = null; let moved = false; let suppressClickUntil = 0; let destroyed = false;
  const previousStyles = { transform: art.style.transform, transformOrigin: art.style.transformOrigin, touchAction: viewport.style.touchAction };
  art.style.transformOrigin = '50% 50%'; viewport.style.touchAction = 'none';
  let lastDimensions = { width: 0, height: 0 };
  let artWidth = 0; let artHeight = 0;
  const [west, south, east, north] = externalAssets.map.bbox;
  const aspect = (east - west) * Math.cos((north + south) / 2 * Math.PI / 180) / (north - south);
  let facilityKind = 'all'; let selectedFacility = null;
  const facilityMarkers = [...art.querySelectorAll('[data-facility]')];
  const markers = [...art.querySelectorAll('[data-poi]')];
  const featured = ['eiffel','pyramid','liberty','sydney','niagara','colosseum','taj','pisa','arc'];
  const priority = marker => Number(marker.classList.contains('selected') || marker.classList.contains('recommended')) * 100 + (featured.includes(marker.dataset.poi) ? 20-featured.indexOf(marker.dataset.poi) : 0);
  const refreshMarkers = () => {
    if (mood) mood.hidden = facilityKind !== 'all' || state.scale > 1.01 || ((lastDimensions.height-artHeight)/2 < 145 && (lastDimensions.width-artWidth)/2 < 250);
    const kept = [];
    for (const marker of [...facilityMarkers].sort((a,b) => Number(b.dataset.facility === selectedFacility)-Number(a.dataset.facility === selectedFacility))) {
      const item = facilities.find(f => f.id === marker.dataset.facility);
      const x = item.position.x/100*artWidth*state.scale; const y = item.position.y/100*artHeight*state.scale;
      const selected = item.id === selectedFacility;
      marker.classList.toggle('highlighted', facilityKind === item.kind);
      marker.classList.toggle('selected', selected); marker.setAttribute('aria-pressed', String(selected));
      marker.hidden = (facilityKind !== 'all' && item.kind !== facilityKind) || kept.some(p => Math.abs(p.x-x)<52 && Math.abs(p.y-y)<52);
      if (!marker.hidden) kept.push({x,y,facility:true});
    }
    const sorted = [...markers].sort((a,b) => priority(b)-priority(a));
    for (const marker of sorted) {
      const poi = pois.find(p => p.id === marker.dataset.poi);
      const x = poi.position.x / 100 * artWidth * state.scale;
      const y = poi.position.y / 100 * artHeight * state.scale;
      const overlaps = kept.some(p => Math.abs(p.x - x) < (p.facility ? 42 : 56) && Math.abs(p.y - y) < 52);
      marker.hidden = overlaps;
      if (!overlaps) kept.push({x,y});
    }
    bubbles.refresh();
  };
  const dimensions = () => {
    const width = viewport.clientWidth; const height = viewport.clientHeight;
    // display:none reports zero dimensions. Preserve the last visible geometry
    // so a background ResizeObserver notification cannot erase the map position.
    if (width > 0 && height > 0) {
      lastDimensions = { width, height };
      artWidth = Math.max(1, Math.min(width, height * aspect)); artHeight = artWidth / aspect;
      Object.assign(art.style, { width: `${artWidth}px`, height: `${artHeight}px`, left: `${(width-artWidth)/2}px`, top: `${(height-artHeight)/2}px` });
    }
    return lastDimensions;
  };
  const listen = (target, name, handler, options) => { target.addEventListener(name, handler, options); listeners.push(() => target.removeEventListener(name, handler, options)); };
  const setState = (next) => {
    if (destroyed) return;
    const { width, height } = dimensions(); state = clampMapTransform(next, width, height, MAP_LIMITS, artWidth, artHeight);
    art.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
    art.style.setProperty('--map-scale', state.scale); refreshMarkers();
    if (output) output.textContent = `${Math.round(state.scale * 100)}%`;
    if (zoomIn) zoomIn.disabled = state.scale >= MAP_LIMITS.maxScale;
    if (zoomOut) zoomOut.disabled = state.scale <= MAP_LIMITS.minScale;
  };
  const zoom = (factor, x = 0, y = 0) => { const { width, height } = dimensions(); setState(zoomMapAt(state, factor, x, y, width, height, artWidth, artHeight)); };
  const beginGesture = () => { gesture = { state: { ...state }, points: [...pointers.values()].slice(0, 2).map((point) => ({ ...point })) }; };
  const point = (event) => ({ x: event.clientX, y: event.clientY });
  const isControl = (target) => !!target?.closest?.('.map-controls, .catalog-trigger, .facility-filters, .map-caption, .map-bubble');

  listen(viewport, 'pointerdown', (event) => {
    if (isControl(event.target) || event.button !== 0 || pointers.size >= 2) return;
    if (!pointers.size) { moved = false; suppressClickUntil = 0; }
    pointers.set(event.pointerId, point(event)); if (pointers.size > 1) moved = true;
    beginGesture();
  });
  listen(view, 'pointermove', (event) => {
    if (!pointers.has(event.pointerId) || !gesture) return;
    pointers.set(event.pointerId, point(event)); const points = [...pointers.values()]; const { width, height } = dimensions();
    if (points.length > 1) {
      moved = true; setState(pinchMapTransform(gesture.state, gesture.points, points, viewport.getBoundingClientRect(), width, height, artWidth, artHeight));
    } else {
      const dx = points[0].x - gesture.points[0].x; const dy = points[0].y - gesture.points[0].y;
      if (Math.hypot(dx, dy) > 6) moved = true;
      if (moved) setState({ ...gesture.state, x: gesture.state.x + dx, y: gesture.state.y + dy });
    }
    if (moved) {
      event.preventDefault(); viewport.classList.add('is-dragging');
      // Capture after dragging starts so a simple tap keeps its POI click target.
      try { viewport.setPointerCapture(event.pointerId); } catch { /* pointer no longer active */ }
    }
  }, { passive: false });
  const finishPointer = (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    try { if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    if (moved || event.type === 'pointercancel') suppressClickUntil = Date.now() + 450;
    if (pointers.size) beginGesture(); else { gesture = null; viewport.classList.remove('is-dragging'); }
  };
  listen(view, 'pointerup', finishPointer); listen(view, 'pointercancel', finishPointer);
  listen(viewport, 'lostpointercapture', (event) => {
    // A touch target may lose implicit capture when the viewport takes over.
    // Its bubbling event does not mean the viewport's gesture has ended.
    if (event.target === viewport) finishPointer(event);
  });
  listen(view, 'blur', () => {
    pointers.clear(); gesture = null; moved = false;
    viewport.classList.remove('is-dragging');
  });
  listen(viewport, 'click', (event) => {
    if (event.detail !== 0 && Date.now() < suppressClickUntil && !isControl(event.target)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    const facilityButton = event.target.closest?.('button[data-facility]');
    if (facilityButton && viewport.contains(facilityButton)) onFacility(facilityButton.dataset.facility);
    const filter = event.target.closest?.('[data-facility-kind]');
    if (filter && viewport.contains(filter)) onFacilityKind(filter.dataset.facilityKind);
    const button = event.target.closest?.('button[data-poi]');
    if (button && viewport.contains(button)) onSelect(button.dataset.poi);
  }, true);
  if (controls) listen(controls, 'click', (event) => {
    const action = event.target.closest?.('[data-map-action]')?.dataset.mapAction;
    if (action === 'zoom-in') zoom(1.3); else if (action === 'zoom-out') zoom(1 / 1.3); else if (action === 'reset') { setState(home); }
  });
  listen(viewport, 'wheel', (event) => {
    if (isControl(event.target)) return;
    event.preventDefault(); const rect = viewport.getBoundingClientRect();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
    zoom(Math.exp(-Math.max(-120, Math.min(120, delta)) * 0.002), event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2);
  }, { passive: false });
  listen(viewport, 'keydown', (event) => {
    if (event.key === 'Escape' && bubbles.isOpen()) {
      event.preventDefault(); bubbles.dismiss(); return;
    }
    if (event.target !== viewport || event.altKey || event.ctrlKey || event.metaKey) return;
    const directions = { ArrowLeft: [36, 0], ArrowRight: [-36, 0], ArrowUp: [0, 36], ArrowDown: [0, -36] };
    if (directions[event.key]) { const [x, y] = directions[event.key]; setState({ ...state, x: state.x + x, y: state.y + y }); }
    else if (event.key === '+' || event.key === '=') zoom(1.3);
    else if (event.key === '-' || event.key === '_') zoom(1 / 1.3);
    else if (event.key === 'Home' || event.key === '0') setState(home);
    else return;
    event.preventDefault();
  });
  const resizeObserver = view.ResizeObserver ? new view.ResizeObserver(() => setState(state)) : null;
  resizeObserver?.observe(viewport); if (!resizeObserver) listen(view, 'resize', () => setState(state));
  setState(state);
  const cleanup = () => {
    if (destroyed) return; destroyed = true;
    for (const id of pointers.keys()) { try { if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id); } catch { /* already released */ } }
    pointers.clear(); listeners.forEach((remove) => remove()); resizeObserver?.disconnect(); bubbles.destroy();
    art.style.transform = previousStyles.transform; art.style.transformOrigin = previousStyles.transformOrigin; viewport.style.touchAction = previousStyles.touchAction;
    viewport.classList.remove('is-dragging');
  };
  cleanup.reset = () => setState(home);
  cleanup.focusPoi = (id) => {
    const poi = pois.find((item) => item.id === id); if (!poi?.position || destroyed) return;
    const { width, height } = dimensions(); const scale = Math.max(1.6, state.scale);
    setState({ scale, x: -(poi.position.x / 100 - 0.5) * artWidth * scale, y: -(poi.position.y / 100 - 0.5) * artHeight * scale });
  };
  const popMarkers = (items) => {
    for (const marker of items) {
      const pin = marker.querySelector('.facility-pin, .map-poi-pin');
      pin?.getAnimations().forEach(animation => animation.cancel());
      if (!pin || view.matchMedia?.('(prefers-reduced-motion: reduce)').matches) continue;
      const scale = marker.classList.contains('highlighted') ? 1.22 : 1;
      pin.animate([
        { transform: `scale(${scale * .82})` },
        { transform: `translateY(-6px) scale(${scale * 1.2})`, offset: .45 },
        { transform: `scale(${scale})` },
      ], { duration: 520, easing: 'cubic-bezier(.2,.7,.3,1)' });
    }
  };
  cleanup.showFacilities = (info = null) => {
    if (destroyed) return;
    facilityKind = info?.kind ?? 'all'; selectedFacility = info?.id ?? null;
    viewport.dataset.facilityView = facilityKind;
    for (const button of viewport.querySelectorAll('[data-facility-kind]')) button.setAttribute('aria-pressed', String(button.dataset.facilityKind === facilityKind || (button.dataset.facilityKind === 'service' && info && !info.items.some(item => item.position))));
    bubbles.show(info);
    refreshMarkers();
    popMarkers(facilityMarkers.filter(marker => !marker.hidden && marker.classList.contains('highlighted')));
  };
  cleanup.revealScenery = () => {
    setState(home);
    popMarkers(markers.filter(marker => !marker.hidden));
  };
  cleanup.focusFacility = id => {
    const item = facilities.find(f => f.id === id);
    if (!item?.position || destroyed) return;
    dimensions();
    const scale = Math.max(2.4, state.scale);
    setState({scale, x:-(item.position.x/100-.5)*artWidth*scale, y:-(item.position.y/100-.5)*artHeight*scale});
  };
  cleanup.focusFacilities = ids => {
    const points = facilities.filter(f => ids.includes(f.id) && f.position).map(f => f.position);
    if (!points.length || destroyed) return;
    dimensions();
    const x = points.reduce((sum,p) => sum+p.x,0)/points.length;
    const y = points.reduce((sum,p) => sum+p.y,0)/points.length;
    const scale = points.length > 1 ? 3.2 : 2.4;
    setState({scale,x:-(x/100-.5)*artWidth*scale,y:-(y/100-.5)*artHeight*scale-24});
  };
  cleanup.refresh = refreshMarkers;
  return cleanup;
}
