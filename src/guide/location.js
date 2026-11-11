import { pois } from '../data/pois.js';
import { externalAssets } from '../data/external-assets.js';
const [west, south, east, north] = externalAssets.map.bbox;
export const locatedPois = pois.filter(poi => poi.position);
export function toCoordinates({ x, y }) {
  return { longitude: west + x / 100 * (east - west), latitude: north - y / 100 * (north - south) };
}
export function toMapPosition({ latitude, longitude }) {
  return { x: (longitude - west) / (east - west) * 100, y: (north - latitude) / (north - south) * 100 };
}
export function distanceMeters(a, b) {
  const r = Math.PI / 180;
  const h = Math.sin((b.latitude-a.latitude)*r/2)**2 + Math.cos(a.latitude*r)*Math.cos(b.latitude*r)*Math.sin((b.longitude-a.longitude)*r/2)**2;
  return 12742000 * Math.asin(Math.sqrt(Math.min(1,h)));
}
export function nearestPoi(position) {
  return locatedPois.map(poi => ({ poi, distance: distanceMeters(position, toCoordinates(poi.position)) })).sort((a,b) => a.distance-b.distance)[0];
}
// A larger exit radius prevents repeated arrivals caused by GPS jitter.
export function createArrivalTracker(onArrival) {
  let inside = null;
  return {
    update(position) {
      if (inside && distanceMeters(position,toCoordinates(inside.position)) > 65) inside = null;
      const nearest = nearestPoi(position);
      if (!inside && nearest?.distance <= 35) { inside = nearest.poi; onArrival(inside); }
      return nearest;
    },
    reset() { inside = null; },
  };
}
