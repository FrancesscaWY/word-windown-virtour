/**
 * Restrained, front-facing motion for the reference artwork players.
 * Positions and pivots stay in source-image coordinates. In particular the
 * two feet may shorten vertically, but never rotate or slide into each other.
 * This is also the pose contract used by the offline sprite renderer.
 */
export const REFERENCE_FRAME_RATE = 12;
export const referenceAvatarCapabilities = Object.freeze({
  actions: Object.freeze(['idle', 'walk', 'wave', 'point']),
  expressions: Object.freeze(['neutral', 'happy', 'curious', 'concerned']),
  supportedActions: Object.freeze(['idle', 'walk', 'wave', 'point']),
  supportedExpressions: Object.freeze(['neutral', 'happy', 'curious', 'concerned']),
  lipSync: 'playback-driven',
});

const finiteTime = value => Number.isFinite(value) ? Math.max(0, value) : 0;

export function referenceAction({ action = 'idle', walk = false, wave = false, point = false } = {}) {
  if (wave || action === 'wave') return 'wave';
  if (point || action === 'point') return 'point';
  if (walk || action === 'walk') return 'walk';
  return 'idle';
}

export function sampleReferencePose(time = 0, parameters = {}, height = 400) {
  time = finiteTime(time);
  height = Number.isFinite(height) && height > 0 ? height : 400;
  const action = referenceAction(parameters), walking = action === 'walk';
  const swing = walking ? Math.sin(time * 7) : 0;
  const { emotion = 'neutral', listen = false } = parameters;
  return {
    rootY: (walking ? -Math.abs(swing) * .004 : Math.sin(time * 1.7) * .0015) * height,
    // A single painted head has no hidden neck pixels. Keep this joint small;
    // listening uses a whole-artwork lean in the player to preserve the seam.
    head: { rotation: Math.sin(time * 1.1) * .003 + (listen ? -.006 : emotion === 'curious' ? .004 : emotion === 'concerned' ? -.003 : 0) },
    legL: { scaleY: 1 - Math.max(0, swing) * .065 },
    legR: { scaleY: 1 - Math.max(0, -swing) * .065 },
    armR: { rotation: action === 'wave' ? -.22 + Math.sin(time * 6) * .07 : action === 'point' ? -.26 : walking ? -.025 + swing * .04 : Math.sin(time * 1.7) * .008 },
    tail: { rotation: Math.sin(time * 1.6) * .018 },
    scarfTail: { rotation: Math.sin(time * (walking ? 7 : 1.7)) * (walking ? .022 : .009) },
  };
}

/** Select a baked pose; the source frame's pose is used for the facial overlay. */
export function sampleReferenceFrame(data, time = 0, parameters = {}) {
  const requested = referenceAction(parameters);
  const action = data.actions?.[requested]?.length ? requested : 'idle';
  const sequence = data.actions?.[action];
  if (!sequence?.length || !data.frames?.length) throw new TypeError('Reference sprite atlas has no playable frames');
  // The idle, walking and waving poses are baked over different durations.
  // Playing every sequence at 12 fps would speed up the slow breathing cycle.
  const duration = data.actionDurations?.[action];
  const frameRate = Number.isFinite(data.frameRate) && data.frameRate > 0 ? data.frameRate : REFERENCE_FRAME_RATE;
  const position = Number.isFinite(duration) && duration > 0
    ? finiteTime(time) % duration / duration * sequence.length
    : finiteTime(time) * frameRate;
  const index = sequence[Math.floor(position) % sequence.length];
  const frame = data.frames[index];
  if (!frame) throw new RangeError(`Reference sprite frame ${index} is missing`);
  return { action, index, frame };
}

/** Mouth animation follows playback state; it does not claim phoneme inference. */
export function selectReferenceFace(face, time = 0, { emotion = 'neutral', talk = false } = {}) {
  time = finiteTime(time);
  const patches = face?.mouth?.patches ?? {};
  let name = Object.hasOwn(patches, emotion) ? emotion : 'neutral';
  if (talk) {
    const openness = Math.abs(Math.sin(time * 13));
    name = openness < .33 ? 'talk0' : openness < .72 ? 'talk1' : 'talk2';
  }
  const patch = patches[name] ?? patches.neutral;
  // Start with open eyes, and do not freeze a character blinking at t=0.
  const blink = time % 4.7 > 4.5 && time % 4.7 < 4.63;
  return { name, patch, blink };
}

/** Canvas/pixel-space point transform, useful for verifying independent feet. */
export function transformReferencePoint(point, pivot, { rotation = 0, scaleX = 1, scaleY = 1 } = {}, rootY = 0) {
  const x = (point[0] - pivot[0]) * scaleX, y = (point[1] - pivot[1]) * scaleY;
  return [pivot[0] + x * Math.cos(rotation) - y * Math.sin(rotation), pivot[1] + x * Math.sin(rotation) + y * Math.cos(rotation) + rootY];
}
