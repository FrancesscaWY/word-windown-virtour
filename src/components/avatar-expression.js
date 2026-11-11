// Concern should read as attentive and reassuring. Keep the original upward
// mouth curve, make it shallower, and preserve its centre instead of flipping it.
export function closedSmilePose(emotion, centerY = 0) {
  const scaleY = emotion === 'concerned' ? .32 : emotion === 'happy' ? 1.25 : 1;
  return { scaleY, offsetY: scaleY === 1 ? 0 : centerY * (1 - scaleY) };
}
