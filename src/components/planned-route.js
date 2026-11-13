import { icon } from './icons.js';

const pathThrough = points => points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(6)},${point.y.toFixed(6)}`).join(' ');

export function routeDisplayGeometry(route) {
  if (route?.geometry?.kind !== 'artwork-traced' || route.geometry.coordinateSpace !== 'artwork-percent') return { points: [], stopIndices: [] };
  return { points: route.geometry.points, stopIndices: route.geometry.stopIndices };
}

export function routePath(route) {
  return pathThrough(routeDisplayGeometry(route).points);
}

/** The server owns tool execution. This component only displays the validated route in state. */
export function mountPlannedRoute({ viewport, store, onClear, onFit }) {
  const doc = viewport.ownerDocument;
  const view = doc.defaultView;
  const layer = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  layer.classList.add('planned-route-line');
  layer.setAttribute('viewBox', '0 0 100 100');
  layer.setAttribute('preserveAspectRatio', 'none');
  layer.setAttribute('aria-hidden', 'true');
  const halo = doc.createElementNS(layer.namespaceURI, 'path');
  halo.classList.add('route-line-halo'); halo.setAttribute('vector-effect', 'non-scaling-stroke');
  const path = doc.createElementNS(layer.namespaceURI, 'path');
  path.setAttribute('vector-effect', 'non-scaling-stroke'); layer.append(halo, path);
  const head = doc.createElementNS(layer.namespaceURI, 'g');
  head.classList.add('route-drawing-head');
  const glow = doc.createElementNS(layer.namespaceURI, 'ellipse');
  const dot = doc.createElementNS(layer.namespaceURI, 'ellipse');
  glow.classList.add('route-head-glow'); dot.classList.add('route-head-dot');
  head.append(glow, dot); layer.append(head);
  viewport.querySelector('.map-art').append(layer);
  const controls = doc.createElement('div');
  controls.className = 'map-route-controls';
  controls.innerHTML = `<span class="map-control-divider" aria-hidden="true"></span><button type="button" class="map-control map-reset" data-route-action="fit" aria-label="查看整条规划路线" title="查看整条规划路线">${icon('compass')}<span>路线</span></button><button type="button" class="map-control" data-route-action="clear" aria-label="清除规划路线" title="清除规划路线">${icon('close')}</button>`;
  viewport.querySelector('.map-controls').append(controls);
  const label = doc.createElement('span');
  label.className = 'planned-route-label';
  const announcement = doc.createElement('span');
  announcement.className = 'sr-only'; announcement.setAttribute('role', 'status');
  viewport.append(label, announcement);
  const markers = [...viewport.querySelectorAll('[data-poi]')];
  const reducedMotion = view.matchMedia?.('(prefers-reduced-motion: reduce)');
  let previous, frame = null;
  const draw = d => { path.setAttribute('d', d); halo.setAttribute('d', d); };
  const stopDrawing = () => {
    if (frame !== null) view.cancelAnimationFrame(frame);
    frame = null; layer.dataset.drawing = 'false'; head.style.display = 'none';
  };
  const completeDrawing = route => {
    stopDrawing(); draw(routePath(route));
    for (const marker of markers) if (marker.classList.contains('route-stop')) marker.classList.add('route-arrived');
  };
  const animateRoute = route => {
    if (reducedMotion?.matches || doc.hidden) { completeDrawing(route); return; }
    const bounds = layer.getBoundingClientRect();
    const { points, stopIndices } = routeDisplayGeometry(route);
    // Measure in screen proportions so diagonals draw at the same speed as horizontal legs.
    const distances = [0];
    for (let i = 1; i < points.length; i++) {
      const from = points[i - 1], to = points[i];
      distances.push(distances.at(-1) + Math.hypot((to.x - from.x) * bounds.width / 100, (to.y - from.y) * bounds.height / 100));
    }
    const total = distances.at(-1);
    if (!total) { completeDrawing(route); return; }
    const duration = Math.min(3800, Math.max(1700, 1200 + total * 1.6 + route.stops.length * 110));
    const routeMarkers = route.stops.map(stop => markers.find(marker => marker.dataset.poi === stop.poiId));
    let started = null, arrived = -1;
    layer.dataset.drawing = 'true'; head.style.display = '';
    const tick = now => {
      started ??= now;
      const progress = Math.min(1, (now - started) / duration);
      const traveled = total * (progress * progress * (3 - 2 * progress));
      let segment = 0;
      while (segment < points.length - 2 && traveled >= distances[segment + 1]) segment++;
      while (arrived + 1 < stopIndices.length && traveled >= distances[stopIndices[arrived + 1]]) routeMarkers[++arrived]?.classList.add('route-arrived');
      if (progress >= 1) { completeDrawing(route); return; }
      const from = points[segment], to = points[segment + 1];
      const fraction = (traveled - distances[segment]) / (distances[segment + 1] - distances[segment] || 1);
      const tip = { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
      draw(pathThrough([...points.slice(0, segment + 1), tip]));
      // The head remains round and the same size while visitors zoom or drag the map.
      const rect = layer.getBoundingClientRect();
      for (const [node, radius] of [[glow, 11], [dot, 4]]) {
        node.setAttribute('cx', tip.x); node.setAttribute('cy', tip.y);
        node.setAttribute('rx', radius * 100 / Math.max(1, rect.width));
        node.setAttribute('ry', radius * 100 / Math.max(1, rect.height));
      }
      head.style.opacity = String(Math.min(1, progress * 12, (1 - progress) * 12));
      frame = view.requestAnimationFrame(tick);
    };
    frame = view.requestAnimationFrame(tick);
  };
  const update = state => {
    const route = state.plannedRoute;
    if (route === previous) return;
    previous = route;
    stopDrawing();
    controls.hidden = !route; label.hidden = !route; layer.style.display = route ? '' : 'none';
    label.textContent = route ? '手绘路网 · 游览路线示意' : '';
    label.title = route?.disclaimer ?? '';
    viewport.dataset.hasRoute = String(Boolean(route));
    draw('');
    for (const marker of markers) {
      const step = route?.stops.findIndex(stop => stop.poiId === marker.dataset.poi) ?? -1;
      marker.classList.toggle('route-stop', step >= 0);
      marker.classList.remove('route-arrived');
      if (step >= 0) marker.dataset.routeStep = String(step + 1);
      else delete marker.dataset.routeStep;
      const name = marker.getAttribute('data-route-name') ?? marker.getAttribute('aria-label');
      marker.setAttribute('data-route-name', name);
      marker.setAttribute('aria-label', step >= 0 ? `路线第${step + 1}站，${name}` : name);
    }
    announcement.textContent = route ? `${route.title}：${route.stops.map((stop, index) => `第${index + 1}站${stop.name}`).join('，')}。已沿手绘道路生成游览路线示意。` : '';
    // Fit after the response has updated the conversation's occupied map area.
    frame = route ? view.requestAnimationFrame(() => {
      frame = null; onFit(route); animateRoute(route);
    }) : null;
  };
  const settleMotion = () => {
    if (previous && (reducedMotion?.matches || doc.hidden)) completeDrawing(previous);
  };
  const click = event => {
    const action = event.target.closest('[data-route-action]')?.dataset.routeAction;
    if (action === 'clear') onClear();
    if (action === 'fit' && store.get().plannedRoute) onFit(store.get().plannedRoute);
  };
  controls.addEventListener('click', click);
  reducedMotion?.addEventListener('change', settleMotion);
  doc.addEventListener('visibilitychange', settleMotion);
  const unsubscribe = store.subscribe(update); update(store.get());
  return () => {
    unsubscribe(); stopDrawing();
    reducedMotion?.removeEventListener('change', settleMotion); doc.removeEventListener('visibilitychange', settleMotion);
    controls.removeEventListener('click', click); controls.remove(); label.remove(); announcement.remove(); layer.remove();
  };
}
