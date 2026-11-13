import { mapCalibration } from '../data/map-calibration.js';

export function triangleWeights(point, a, b, c) {
  const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  const u = ((b[1] - c[1]) * (point.x - c[0]) + (c[0] - b[0]) * (point.y - c[1])) / d;
  const v = ((c[1] - a[1]) * (point.x - c[0]) + (a[0] - c[0]) * (point.y - c[1])) / d;
  return [u, v, 1 - u - v];
}

/** Geographic percentages -> artwork percentages, for display only. */
export function projectMapPosition(point, calibration = mapCalibration) {
  if (!point) return null;
  for (const triangle of calibration.triangles) {
    const weights = triangleWeights(point, ...triangle.map(i => calibration.source[i]));
    if (weights.some(w => w < -1e-8)) continue;
    const target = triangle.map(i => calibration.target[i]);
    return { x: weights.reduce((s, w, i) => s + w * target[i][0], 0), y: weights.reduce((s, w, i) => s + w * target[i][1], 0) };
  }
  // Out-of-map GPS stays out of map; registration must not pull it into the park.
  return { ...point };
}

/** Sample source edges every two artwork pixels before crossing the affine mesh.
 * indices maps each original node to its sampled display point (including repeats).
 * The road overlay and planned route must use this same sampling. */
export function projectMapLine(source, calibration = mapCalibration) {
  if (!source?.length) return { points: [], indices: [] };
  const { width, height } = calibration.artwork;
  const points = [projectMapPosition(source[0], calibration)], indices = [0];
  for (let i = 1; i < source.length; i++) {
    const from = source[i - 1], to = source[i];
    const count = Math.max(1, Math.ceil(Math.hypot((to.x - from.x) * width / 100, (to.y - from.y) * height / 100) / 2));
    for (let step = 1; step <= count; step++) {
      points.push(projectMapPosition({ x: from.x + (to.x - from.x) * step / count, y: from.y + (to.y - from.y) * step / count }, calibration));
    }
    indices.push(points.length - 1);
  }
  return { points, indices };
}
