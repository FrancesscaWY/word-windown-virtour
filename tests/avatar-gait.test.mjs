import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../src/vendor/three.module.js';
import { sampleFrontalGait, sampleBipedGait } from '../src/components/avatar-gait.js';
import { createSvgRig2D, explorerRigMarkup, buildExplorerRig } from '../src/components/explorer-avatar.js';
import { originalFoxRigMarkup, buildOriginalFoxRig } from '../src/components/original-fox-avatar.js';
import { otterRigMarkup, buildOtterRig } from '../src/components/otter-avatar.js';
import { dandelionRigMarkup, buildDandelionRig } from '../src/components/dandelion-avatar.js';

const profiles = {
  fox: { hipHalfWidth: .23, upperLength: .22, lowerLength: .22, stepLength: .05, stepHeight: .026 },
  explorer: { hipHalfWidth: .17, upperLength: .31, lowerLength: .35, stepLength: .045, stepHeight: .035 },
  otter: { hipHalfWidth: .235, upperLength: .18, lowerLength: .18, stepLength: .045, stepHeight: .022 },
  dandelion: { hipHalfWidth: .16, upperLength: .13, lowerLength: .055, stepLength: .025, stepHeight: .012 },
};
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-7, `${label}: ${actual} / ${expected}`);

test('the frontal gait keeps hip anchors, lateral outlines and alternate foot lanes fixed for a full cycle', () => {
  let lifted = 0;
  for (let frame = 0; frame <= 240; frame++) {
    const pose = sampleFrontalGait(frame / 240 * Math.PI / 4);
    for (const side of [pose.left, pose.right]) {
      assert.equal(side.x, 0); assert.equal(side.hipAngle, 0); assert.equal(side.kneeAngle, 0);
      assert.ok(side.scaleY >= .86 && side.scaleY <= 1);
      assert.ok(side.footScaleY >= .95 && side.footScaleY <= 1);
      lifted += side.lift > .5;
    }
    assert.ok(pose.left.lift * pose.right.lift < 1e-12, 'only the swinging foot lifts');
  }
  assert.ok(lifted > 100);
  const rest = sampleFrontalGait(10, false);
  assert.equal(rest.left.scaleY, 1); assert.equal(rest.right.scaleY, 1);
});

for (const [name, markup] of [['fox', originalFoxRigMarkup], ['explorer', explorerRigMarkup], ['otter', otterRigMarkup], ['dandelion', dandelionRigMarkup]]) {
  test(`${name} actual SVG driver keeps both hip origins and horizontal foot shapes fixed while walking`, () => {
    const bones = new Map([...markup().matchAll(/data-bone="([^"]+)"/g)].map(match => {
      const attributes = new Map();
      return [match[1], { dataset: { bone: match[1] }, getAttribute: key => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value) }];
    }));
    const element = { style: {}, querySelectorAll: () => [...bones.values()], remove() {} };
    const previousDocument = globalThis.document;
    let rig;
    try {
      globalThis.document = { createElement: () => ({ content: { firstElementChild: element } }) };
      rig = createSvgRig2D({ append() {} }, { markup: markup(), id: name, name });
    } finally { globalThis.document = previousDocument; }
    try {
      for (let frame = 0; frame <= 120; frame++) {
        rig.draw({ time: frame / 120 * Math.PI / 4, action: 'walk' });
        for (const bone of ['legL', 'legR', ...(bones.has('kneeL') ? ['kneeL', 'kneeR'] : [])]) {
          const transform = bones.get(bone).getAttribute('transform');
          assert.match(transform, /^scale\(1 (?:0\.\d+|1)\)$/);
          assert.doesNotMatch(transform, /rotate|translate/, 'no sideways displacement or rotation through the other leg');
        }
      }
      rig.draw({ time: 1, action: 'idle' });
      assert.equal(bones.get('legL').getAttribute('transform'), 'scale(1 1)');
      assert.equal(bones.get('legR').getAttribute('transform'), 'scale(1 1)');
    } finally { rig.dispose(); }
  });
}

for (const [name, profile] of Object.entries(profiles)) {
  test(`${name} IK soles stay in separate lanes and level across a complete cycle and walking camera angles`, () => {
    for (let frame = 0; frame <= 240; frame++) {
      const pose = sampleBipedGait(frame / 240 * Math.PI / 4, profile);
      for (const side of [pose.left, pose.right]) {
        const kneeY = -profile.upperLength * Math.cos(side.hipAngle);
        const kneeZ = -profile.upperLength * Math.sin(side.hipAngle);
        near(kneeY - profile.lowerLength * Math.cos(side.hipAngle + side.kneeAngle), side.foot.y, 'foot Y solves IK');
        near(kneeZ - profile.lowerLength * Math.sin(side.hipAngle + side.kneeAngle), side.foot.z, 'foot Z solves IK');
        near(side.hipAngle + side.kneeAngle + side.ankleAngle, 0, 'level sole');
        assert.equal(side.foot.x, side.hipX, 'foot never leaves its own lateral lane');
        assert.ok(side.kneeAngle >= 0 && side.kneeAngle < 1.3, 'small forward flexion');
      }
      for (const yaw of [-.9, -.45, 0, .45, .9]) {
        const projectedX = side => side.foot.x * Math.cos(yaw) + side.foot.z * Math.sin(yaw);
        assert.ok(projectedX(pose.right) - projectedX(pose.left) > .1, 'feet do not swap sides in the walking view');
      }
    }
    const rest = sampleBipedGait(2, { ...profile, walking: false });
    for (const side of [rest.left, rest.right]) {
      assert.equal(side.hipAngle, 0); assert.equal(side.kneeAngle, 0); assert.equal(side.ankleAngle, 0);
    }
  });
}

// Test the shipped joints, rather than only reproducing the IK calculation.
// The ordinary walking view is +/- .55; +/- .9 also protects sharper turns.
const builders = { fox: buildOriginalFoxRig, explorer: buildExplorerRig, otter: buildOtterRig, dandelion: buildDandelionRig };
const yawSamples = [-.9, -.55, 0, .55, .9];

function walkingCamera(name) {
  let camera;
  if (name === 'otter') {
    camera = new THREE.OrthographicCamera(-1.38, 1.38, 1.84, -1.84, .1, 20);
    camera.position.set(0, 1.58, 7); camera.lookAt(0, 1.52, 0);
  } else if (name === 'dandelion') {
    camera = new THREE.OrthographicCamera(-1.4625, 1.4625, 1.95, -1.95, .1, 20);
    camera.position.set(.28, 2.11, 8); camera.lookAt(0, 1.84, 0);
  } else {
    camera = new THREE.PerspectiveCamera(name === 'fox' ? 34 : 32, .75, .1, 30);
    camera.position.set(0, name === 'fox' ? 1.7 : 1.65, name === 'fox' ? 6.5 : 5.9);
    camera.lookAt(0, name === 'fox' ? 1.35 : 1.4, 0);
  }
  camera.updateMatrixWorld(true);
  return camera;
}

function limbLocalBounds(limb, root) {
  const bounds = new THREE.Box3(), vertex = new THREE.Vector3();
  const inverseRoot = root.matrixWorld.clone().invert(), matrix = new THREE.Matrix4();
  limb.traverse(object => {
    const positions = object.geometry?.getAttribute('position');
    if (!positions) return;
    matrix.multiplyMatrices(inverseRoot, object.matrixWorld);
    for (let index = 0; index < positions.count; index++) bounds.expandByPoint(vertex.fromBufferAttribute(positions, index).applyMatrix4(matrix));
  });
  return bounds;
}

function segmentsCross(a, b, c, d) {
  const area = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  // Strict crossing excludes harmless shared screen-space endpoints at a turn.
  return area(a, b, c) * area(a, b, d) < -1e-12 && area(c, d, a) * area(c, d, b) < -1e-12;
}

for (const [name, build] of Object.entries(builders)) {
  test(`${name} actual 3D knees, ankles and soles retain separate lanes without projected scissor steps`, () => {
    const rig = build(), profile = profiles[name];
    const hips = [rig.joints.legL, rig.joints.legR];
    const knees = rig.joints.knees ?? [rig.joints.kneeL, rig.joints.kneeR];
    const ankles = rig.joints.ankles ?? [rig.joints.ankleL, rig.joints.ankleR];
    const anchors = hips.map(hip => hip.position.clone());
    const camera = walkingCamera(name);
    try {
      // The full limb volumes (including boots and fur) do not pass through one
      // another. Oblique views can naturally occlude parts of separate limbs.
      rig.draw({ action: 'walk', time: 0 }); rig.root.updateMatrixWorld(true);
      const laneBounds = hips.map(hip => limbLocalBounds(hip, rig.root));
      assert.ok(laneBounds[1].min.x - laneBounds[0].max.x > .02, 'real mesh volumes occupy disjoint lateral lanes');
      for (let frame = 0; frame <= 120; frame++) for (const yaw of yawSamples) {
        const time = frame / 120 * Math.PI / 4, pose = sampleBipedGait(time, profile);
        rig.draw({ time, action: 'walk', turn: yaw }); rig.root.updateMatrixWorld(true);
        const inverseRootRotation = rig.root.getWorldQuaternion(new THREE.Quaternion()).invert();
        for (const [index, side] of [pose.left, pose.right].entries()) {
          assert.ok(hips[index].position.equals(anchors[index]), 'hip anchor never slides across body');
          assert.equal(hips[index].rotation.y, 0); assert.equal(hips[index].rotation.z, 0);
          assert.equal(knees[index].rotation.y, 0); assert.equal(knees[index].rotation.z, 0);
          const knee = rig.root.worldToLocal(knees[index].getWorldPosition(new THREE.Vector3()));
          near(knee.x, anchors[index].x, 'actual knee stays in its hip lane');
          const ankle = rig.root.worldToLocal(ankles[index].getWorldPosition(new THREE.Vector3()));
          near(ankle.x, anchors[index].x, 'actual foot X');
          near(ankle.y - anchors[index].y, side.foot.y, 'actual foot Y');
          near(ankle.z - anchors[index].z, side.foot.z, 'actual foot Z');
          const sole = ankles[index].getWorldQuaternion(new THREE.Quaternion()).premultiply(inverseRootRotation);
          near(Math.abs(sole.w), 1, 'actual sole is level relative to the body');
        }
        const paths = [0, 1].map(index => [hips[index], knees[index], ankles[index]].map(joint => joint.getWorldPosition(new THREE.Vector3()).project(camera)));
        for (let joint = 0; joint < 3; joint++) {
          assert.ok(paths[1][joint].x - paths[0][joint].x > .05, 'projected hip/knee/ankle order never reverses');
          for (const path of paths) assert.ok(Math.abs(path[joint].x) < 1 && Math.abs(path[joint].y) < 1, 'walking joints remain inside the render frame');
        }
        for (let left = 0; left < 2; left++) for (let right = 0; right < 2; right++) {
          assert.equal(segmentsCross(paths[0][left], paths[0][left + 1], paths[1][right], paths[1][right + 1]), false, 'projected thigh/shin segments never cross');
        }
      }
      rig.draw({ action: 'idle', time: 2 });
      for (const hip of hips) assert.equal(hip.rotation.x, 0);
    } finally { rig.dispose(); }
  });
}
