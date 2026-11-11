export const MAP_LIMITS = Object.freeze({ minScale: 1, maxScale: 5.5 });

/** Keep the map covering its viewport, even after resize or invalid input. */
export function clampMapTransform(state, width, height, limits = MAP_LIMITS, contentWidth = width, contentHeight = height) {
  const scale = Math.max(limits.minScale, Math.min(limits.maxScale, Number.isFinite(state.scale) ? state.scale : limits.minScale));
  const bound = (size, content) => Math.max(0, ((Number.isFinite(content) ? content : 0) * scale - (Number.isFinite(size) ? size : 0)) / 2);
  const clamp = (value, size, content) => Math.max(-bound(size, content), Math.min(bound(size, content), Number.isFinite(value) ? value : 0)) || 0;
  return { scale, x: clamp(state.x, width, contentWidth), y: clamp(state.y, height, contentHeight) };
}

/** Anchor coordinates are relative to the viewport center in CSS pixels. */
export function zoomMapAt(state, factor, anchorX, anchorY, width, height, contentWidth = width, contentHeight = height) {
  const current = clampMapTransform(state, width, height, MAP_LIMITS, contentWidth, contentHeight);
  const nextScale = clampMapTransform({ ...current, scale: current.scale * (Number.isFinite(factor) && factor > 0 ? factor : 1) }, width, height, MAP_LIMITS, contentWidth, contentHeight).scale;
  const ratio = nextScale / current.scale;
  return clampMapTransform({ scale: nextScale, x: anchorX - (anchorX - current.x) * ratio, y: anchorY - (anchorY - current.y) * ratio }, width, height, MAP_LIMITS, contentWidth, contentHeight);
}

/** Preserve the map point below a moving two-finger midpoint. */
export function pinchMapTransform(state, startPoints, currentPoints, rect, width, height, contentWidth = width, contentHeight = height) {
  if (startPoints.length < 2 || currentPoints.length < 2) return clampMapTransform(state, width, height, MAP_LIMITS, contentWidth, contentHeight);
  const midpoint = (points) => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
  const distance = (points) => Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  const start = midpoint(startPoints); const current = midpoint(currentPoints);
  const startDistance = distance(startPoints);
  const factor = startDistance > 0.5 ? distance(currentPoints) / startDistance : 1;
  const before = clampMapTransform(state, width, height, MAP_LIMITS, contentWidth, contentHeight);
  const scale = clampMapTransform({ ...before, scale: before.scale * factor }, width, height, MAP_LIMITS, contentWidth, contentHeight).scale;
  const ratio = scale / before.scale;
  // Combine midpoint movement and scaling before clamping the pan. Clamping an
  // intermediate zoom can discard valid movement back from a map boundary.
  return clampMapTransform({
    scale,
    x: current.x - rect.left - width / 2 - (start.x - rect.left - width / 2 - before.x) * ratio,
    y: current.y - rect.top - height / 2 - (start.y - rect.top - height / 2 - before.y) * ratio,
  }, width, height, MAP_LIMITS, contentWidth, contentHeight);
}
