import { getPoi } from '../data/pois.js';
import { artworkRoads } from '../data/artwork-roads.js';

const position = point => point && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 100 && point.y >= 0 && point.y <= 100;
const samePoint = (a, b) => a.x === b.x && a.y === b.y;
const nodes = new Map(artworkRoads.nodes.map(node => [node.id, node]));
const edges = new Map(artworkRoads.roads.map(road => [road.id, new Set(road.nodeIds.slice(1).flatMap((id, i) => [`${road.nodeIds[i]}:${id}`, `${id}:${road.nodeIds[i]}`]))]));

function routeGeometry(route) {
  const g = route.geometry;
  if (g?.kind !== 'artwork-traced' || g.coordinateSpace !== 'artwork-percent' || g.sourceSha256 !== artworkRoads.sourceSha256) return null;
  if (!Array.isArray(g.points) || g.points.length < 2 || g.points.length > 12000 || !g.points.every(position)) return null;
  if (!Array.isArray(g.nodeIds) || g.nodeIds.length !== g.points.length || !g.nodeIds.every(id => nodes.has(id))) return null;
  if (g.points.some((point, i) => !samePoint(point, nodes.get(g.nodeIds[i])))) return null;
  if (!Array.isArray(g.roadIds) || g.roadIds.length !== g.points.length - 1 || g.roadIds.some((id, i) => !edges.get(id)?.has(`${g.nodeIds[i]}:${g.nodeIds[i + 1]}`))) return null;
  if (!Array.isArray(g.stopIndices) || g.stopIndices.length !== route.stops.length || g.stopIndices[0] !== 0 || g.stopIndices.at(-1) !== g.points.length - 1) return null;
  if (g.stopIndices.some((n, i) => !Number.isInteger(n) || n < 0 || n >= g.points.length || (i > 0 && n < g.stopIndices[i - 1]))) return null;
  if (!Array.isArray(g.legs) || g.legs.length !== route.stops.length - 1 || route.distanceMeters !== null) return null;
  for (let i = 0; i < g.legs.length; i++) {
    const leg = g.legs[i];
    if (!leg || leg.from !== route.stops[i]?.poiId || leg.to !== route.stops[i + 1]?.poiId || leg.startIndex !== g.stopIndices[i] || leg.endIndex !== g.stopIndices[i + 1]) return null;
  }
  return {
    kind: g.kind, coordinateSpace: g.coordinateSpace, sourceSha256: g.sourceSha256,
    points: g.points.map(({ x, y }) => ({ x, y })), nodeIds: [...g.nodeIds], roadIds: [...g.roadIds], stopIndices: [...g.stopIndices],
    legs: g.legs.map(({ from, to, startIndex, endIndex }) => ({ from, to, startIndex, endIndex })),
  };
}

/** React only to successful, allowlisted backend results; never execute model-provided code. */
export function toolEffect(trace) {
  if (trace?.name !== 'plan_route' || trace.status !== 'done' || trace.result?.error || trace.result?.status !== 'success') return null;
  const route = trace.result.route;
  const bounded = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
  if (route?.kind !== 'llm-suggested' || !bounded(route.title, 80) || !bounded(route.summary, 500) || !bounded(route.disclaimer, 500)) return null;
  if (!Array.isArray(route.stops) || route.stops.length < 2 || route.stops.length > 12) return null;
  const geometry = routeGeometry(route);
  if (!geometry) return null;
  const ids = new Set();
  const stops = [];
  for (const stop of route.stops) {
    const poi = getPoi(stop?.poiId);
    if (!poi?.position || !poi.locationVerified || ids.has(poi.id) || !bounded(stop.reason, 200)) return null;
    const anchor = stop.roadAnchor, index = geometry.stopIndices[stops.length];
    if (!anchor || anchor.nodeId !== geometry.nodeIds[index] || anchor.nodeId !== artworkRoads.anchors[poi.id] || !position(anchor.position) || !samePoint(anchor.position, geometry.points[index]) || anchor.entranceVerified !== false) return null;
    ids.add(poi.id);
    // Use trusted catalog metadata, not coordinates or HTML supplied by an upstream result.
    stops.push({ poiId: poi.id, name: poi.name, position: poi.position, reason: stop.reason,
      roadAnchor: { nodeId: anchor.nodeId, position: { ...geometry.points[index] }, entranceVerified: false } });
  }
  return {
    plannedRoute: { kind: route.kind, title: route.title, summary: route.summary, stops, geometry, distanceMeters: route.distanceMeters, disclaimer: route.disclaimer,
      source: { name: '按手绘底图描绘的路网', url: '/assets/map.jpg', kind: 'illustration' } },
    view: 'map', detailsOpen: false, activeHotspotId: null, facilityInfo: null, visitInfo: null,
    clarification: null, recommendedPoiIds: [],
  };
}
