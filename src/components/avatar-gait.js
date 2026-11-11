/**
 * A front-facing sprite cannot express depth by rotating legs across its body.
 * Keep both hip anchors and lateral outlines fixed; shorten the swinging leg
 * vertically instead. This makes two separate foot lanes at every frame.
 */
export function sampleFrontalGait(time = 0, walking = true) {
  const phase = time * 8;
  const side = offset => {
    const lift = walking ? Math.max(0, Math.sin(phase + offset)) : 0;
    return { x: 0, hipAngle: 0, kneeAngle: 0, scaleY: 1 - lift * .14, footScaleY: 1 - lift * .05, lift };
  };
  return { left: side(0), right: side(Math.PI), swing: walking ? Math.sin(phase) : 0 };
}

/**
 * Two-link sagittal-plane IK. X is the immutable hip lane, Y is up and Z is
 * forward. Positive knee flexion bends backwards; an ankle counter-rotation
 * keeps the sole level instead of pointing it through the opposite shin.
 */
export function sampleBipedGait(time = 0, {
  walking = true, hipHalfWidth, upperLength, lowerLength, stepLength, stepHeight,
} = {}) {
  const reach = upperLength + lowerLength;
  const stride = Math.min(Math.abs(stepLength), reach * .18, hipHalfWidth * .28);
  const height = Math.min(Math.abs(stepHeight), reach * .09);
  const contactY = Math.sqrt(reach * reach - stride * stride);
  const clamp = value => Math.max(-1, Math.min(1, value));
  const side = (sign, offset) => {
    const phase = time * 8 + offset;
    if (!walking) return { hipX: sign * hipHalfWidth, hipAngle: 0, kneeAngle: 0, ankleAngle: 0, foot: { x: sign * hipHalfWidth, y: -reach, z: 0 } };
    const lift = Math.max(0, Math.sin(phase)) * height;
    const y = -contactY + lift, z = -Math.cos(phase) * stride;
    const distance = Math.hypot(y, z);
    const hipAngle = Math.atan2(-z, -y) - Math.acos(clamp((upperLength ** 2 + distance ** 2 - lowerLength ** 2) / (2 * upperLength * distance)));
    const kneeAngle = Math.acos(clamp((distance ** 2 - upperLength ** 2 - lowerLength ** 2) / (2 * upperLength * lowerLength)));
    return { hipX: sign * hipHalfWidth, hipAngle, kneeAngle, ankleAngle: -hipAngle - kneeAngle, foot: { x: sign * hipHalfWidth, y, z } };
  };
  return { left: side(-1, 0), right: side(1, Math.PI), swing: walking ? Math.sin(time * 8) : 0 };
}

export function applyBipedGait(pose, legs, knees, ankles) {
  for (const [index, side] of [pose.left, pose.right].entries()) {
    // Do not yaw/roll the hip or move it sideways: those introduce cross-steps.
    legs[index].rotation.set(side.hipAngle, 0, 0);
    knees[index].rotation.set(side.kneeAngle, 0, 0);
    ankles[index].rotation.set(side.ankleAngle, 0, 0);
  }
}
