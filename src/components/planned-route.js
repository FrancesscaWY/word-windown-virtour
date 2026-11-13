import { icon } from './icons.js';

export function routePath(route) {
  return (route?.stops ?? []).map(({ position }, index) => `${index ? 'L' : 'M'}${position.x},${position.y}`).join(' ');
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
  viewport.querySelector('.map-art').append(layer);
  const controls = doc.createElement('div');
  controls.className = 'map-route-controls';
  controls.innerHTML = `<span class="map-control-divider" aria-hidden="true"></span><button type="button" class="map-control map-reset" data-route-action="fit" aria-label="查看整条规划路线" title="查看整条规划路线">${icon('compass')}<span>路线</span></button><button type="button" class="map-control" data-route-action="clear" aria-label="清除规划路线" title="清除规划路线">${icon('close')}</button>`;
  viewport.querySelector('.map-controls').append(controls);
  const label = doc.createElement('span');
  label.className = 'planned-route-label'; label.textContent = '游览顺序示意 · 非步行导航';
  const announcement = doc.createElement('span');
  announcement.className = 'sr-only'; announcement.setAttribute('role', 'status');
  viewport.append(label, announcement);
  let previous, frame = null;
  const update = state => {
    const route = state.plannedRoute;
    if (route === previous) return;
    previous = route;
    controls.hidden = !route; label.hidden = !route; layer.style.display = route ? '' : 'none';
    viewport.dataset.hasRoute = String(Boolean(route));
    path.setAttribute('d', routePath(route));
    halo.setAttribute('d', routePath(route));
    for (const marker of viewport.querySelectorAll('[data-poi]')) {
      const step = route?.stops.findIndex(stop => stop.poiId === marker.dataset.poi) ?? -1;
      marker.classList.toggle('route-stop', step >= 0);
      if (step >= 0) marker.dataset.routeStep = String(step + 1);
      else delete marker.dataset.routeStep;
      const name = marker.getAttribute('data-route-name') ?? marker.getAttribute('aria-label');
      marker.setAttribute('data-route-name', name);
      marker.setAttribute('aria-label', step >= 0 ? `路线第${step + 1}站，${name}` : name);
    }
    announcement.textContent = route ? `${route.title}：${route.stops.map((stop, index) => `第${index + 1}站${stop.name}`).join('，')}。地图已绘制游览顺序。` : '';
    if (frame !== null) view.cancelAnimationFrame(frame);
    // Fit after the response has updated the conversation's occupied map area.
    frame = route ? view.requestAnimationFrame(() => { frame = null; onFit(route.stops.map(stop => stop.poiId)); }) : null;
  };
  const click = event => {
    const action = event.target.closest('[data-route-action]')?.dataset.routeAction;
    if (action === 'clear') onClear();
    if (action === 'fit' && store.get().plannedRoute) onFit(store.get().plannedRoute.stops.map(stop => stop.poiId));
  };
  controls.addEventListener('click', click);
  const unsubscribe = store.subscribe(update); update(store.get());
  return () => {
    unsubscribe(); if (frame !== null) view.cancelAnimationFrame(frame);
    controls.removeEventListener('click', click); controls.remove(); label.remove(); announcement.remove(); layer.remove();
  };
}
