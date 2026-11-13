import { getPoi } from '../data/pois.js';

/** React only to successful, allowlisted backend results; never execute model-provided code. */
export function toolEffect(trace) {
  if (trace?.name !== 'plan_route' || trace.status !== 'done' || trace.result?.error || trace.result?.status !== 'success') return null;
  const route = trace.result.route;
  const bounded = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
  if (route?.kind !== 'llm-suggested' || !bounded(route.title, 80) || !bounded(route.summary, 500) || !bounded(route.disclaimer, 500)) return null;
  if (!Array.isArray(route.stops) || route.stops.length < 2 || route.stops.length > 12) return null;
  const ids = new Set();
  const stops = [];
  for (const stop of route.stops) {
    const poi = getPoi(stop?.poiId);
    if (!poi?.position || !poi.locationVerified || ids.has(poi.id) || !bounded(stop.reason, 200)) return null;
    ids.add(poi.id);
    // Use trusted catalog metadata, not coordinates or HTML supplied by an upstream result.
    stops.push({ poiId: poi.id, name: poi.name, position: poi.position, reason: stop.reason });
  }
  return {
    plannedRoute: { title: route.title, summary: route.summary, stops, disclaimer: route.disclaimer },
    view: 'map', detailsOpen: false, activeHotspotId: null, facilityInfo: null, visitInfo: null,
    clarification: null, recommendedPoiIds: [],
  };
}
