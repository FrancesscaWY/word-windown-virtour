const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

/** A screen companion is an overlay, so its size follows the viewport rather than map zoom. */
export function companionSize({ viewportHeight, stageWidth, availableHeight }) {
  const preferredHeight = clamp(finite(viewportHeight) * .22, 100, 210);
  // Leave room for the map and controls even on short or narrow displays.
  const height = Math.max(0, Math.min(preferredHeight, finite(availableHeight) * .58, Math.max(0, finite(stageWidth) - 24) * 4 / 3));
  return { width: height * .75, height };
}

/**
 * Decide real displacement before requesting an animation. Explicit walk/run
 * patrols between the horizontal limits even after manual placement; the
 * automatic switch controls only unsolicited docking moves. Dragging stops an
 * explicit patrol in the controller, and every suspension produces idle feet.
 */
export function advanceCompanionMotion({ x, target, bounds, action = 'idle', roaming = false, placed = false, blocked = false, reduced = false, dt = 0, height = 180 }) {
  const left = finite(bounds?.left);
  const right = Math.max(left, finite(bounds?.right, left));
  x = clamp(finite(x, left), left, right);
  target = clamp(finite(target, x), left, right);
  const manual = action === 'walk' || action === 'run';
  const allowed = !blocked && !reduced && (manual || (roaming && !placed)) && right - left > 1;
  if (manual && allowed) {
    if (Math.abs(target - x) <= 1) target = x <= (left + right) / 2 ? right : left;
    else target = target > x ? right : left;
  }
  const speed = clamp(finite(height, 180) * .34, 32, 70) * (action === 'run' ? 1.7 : 1);
  const previousX = x;
  if (allowed && Math.abs(target - x) > .01) {
    x += Math.sign(target - x) * Math.min(Math.abs(target - x), clamp(finite(dt), 0, .1) * speed);
  }
  const distance = Math.abs(x - previousX);
  const moving = distance > .001;
  return {
    x, target, distance, moving,
    direction: moving ? Math.sign(x - previousX) : 0,
    walk: moving,
    run: moving && action === 'run',
    // Original rigs also infer gait from action, so suppress that fallback
    // whenever a requested walk/run could not produce actual displacement.
    action: manual && !moving ? 'idle' : action,
  };
}
