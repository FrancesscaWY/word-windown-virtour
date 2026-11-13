import { artworkRoads } from '../data/artwork-roads.js';

const nodes = new Map(artworkRoads.nodes.map(node => [node.id, node]));
const paths = artworkRoads.roads.map(road => ({ ...road, d: road.nodeIds.map((id, i) => { const p = nodes.get(id); return `${i ? 'L' : 'M'}${p.x.toFixed(6)},${p.y.toFixed(6)}`; }).join(' ') }));

export function roadNetworkMarkup() {
  return `<svg id="map-road-network" class="map-road-network" data-source="artwork-traced" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><g class="road-network-casing">${paths.map(road => `<path d="${road.d}" vector-effect="non-scaling-stroke"/>`).join('')}</g><g>${paths.map(road => `<path class="road-network-${road.kind}" data-road-id="${road.id}" d="${road.d}" vector-effect="non-scaling-stroke"/>`).join('')}</g></svg>`;
}

export function mountRoadNetwork(viewport) {
  const layer = viewport.querySelector('.map-road-network');
  const button = viewport.querySelector('[data-map-action="roads"]');
  if (!layer || !button) return () => {};
  const view = viewport.ownerDocument.defaultView;
  const key = 'virtour.map.roads.visible';
  let visible = true;
  try { visible = view.localStorage.getItem(key) !== 'false'; } catch { /* private/offline storage may be disabled */ }
  const update = () => {
    layer.style.display = visible ? '' : 'none';
    viewport.dataset.roadsVisible = String(visible);
    button.setAttribute('aria-pressed', String(visible));
    button.setAttribute('aria-label', visible ? '隐藏路网' : '显示路网');
    button.title = visible ? '隐藏路网' : '显示路网';
  };
  const toggle = () => {
    visible = !visible; update();
    try { view.localStorage.setItem(key, String(visible)); } catch { /* toggling still works without storage */ }
  };
  update(); button.addEventListener('click', toggle);
  return () => button.removeEventListener('click', toggle);
}
