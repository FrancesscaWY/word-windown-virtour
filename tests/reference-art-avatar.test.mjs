import test from 'node:test';
import assert from 'node:assert/strict';
import {
  referenceAvatarCapabilities,
  referenceAction,
  sampleReferencePose,
  sampleReferenceFrame,
  selectReferenceFace,
  transformReferencePoint,
} from '../src/components/reference-avatar-motion.js';

test('reference artwork gait keeps both complete foot outlines in their own source-image lanes', () => {
  const sourceFeet = [
    { name: 'legL', pivot: [100, 270], points: [[83, 270], [117, 270], [84, 335], [116, 335]] },
    { name: 'legR', pivot: [150, 270], points: [[133, 270], [167, 270], [134, 335], [166, 335]] },
  ];
  for (let frame = 0; frame < 240; frame++) {
    const pose = sampleReferencePose(frame / 120, { action: 'walk' }, 360);
    const bounds = sourceFeet.map(foot => {
      const joint = pose[foot.name];
      assert.ok(joint.scaleY >= .935 && joint.scaleY <= 1);
      assert.equal(joint.rotation, undefined);
      return foot.points.map(point => {
        const projected = transformReferencePoint(point, foot.pivot, joint, pose.rootY);
        assert.equal(projected[0], point[0], 'entire outline preserves its source X coordinate');
        return projected[0];
      });
    });
    assert.ok(Math.max(...bounds[0]) < Math.min(...bounds[1]), 'left and right silhouettes do not overlap');
  }
  const stopped = sampleReferencePose(2, { action: 'idle' });
  assert.equal(stopped.legL.scaleY, 1); assert.equal(stopped.legR.scaleY, 1);
});

test('reference motion preserves small original-art deformations and does not promise a turnable 3D model', () => {
  assert.deepEqual(referenceAvatarCapabilities.actions, ['idle', 'walk', 'wave', 'point']);
  assert.equal(referenceAction({ action: 'turn' }), 'idle');
  for (const emotion of referenceAvatarCapabilities.expressions) {
    for (const action of referenceAvatarCapabilities.actions) {
      for (let frame = 0; frame < 60; frame++) {
        const pose = sampleReferencePose(frame / 12, { action, emotion, listen: frame % 2 === 0 }, 900);
        assert.ok(Math.abs(pose.head.rotation) <= .009, 'neck joint stays within the restrained painted overlap');
        assert.ok(Math.abs(pose.armR.rotation) <= .3);
        assert.ok(Math.abs(pose.rootY) < 4);
      }
    }
  }
});

test('baked sprite playback only reads frames from the chosen action and wraps locally at 12 fps', () => {
  const frames = Array.from({ length: 7 }, (_, index) => ({ x: index * 288, y: 0, pose: {} }));
  const data = { frames, actions: { idle: [0], walk: [1, 2, 3], wave: [4, 5], point: [6] } };
  for (const [action, sequence] of Object.entries(data.actions)) {
    for (let frame = 0; frame < 60; frame++) {
      const selected = sampleReferenceFrame(data, frame / 12 + .00001, { action });
      assert.equal(selected.index, sequence[frame % sequence.length]);
      assert.equal(selected.frame, frames[selected.index]);
    }
  }
  assert.equal(sampleReferenceFrame(data, 42, { action: 'turn' }).index, 0);
  assert.equal(sampleReferenceFrame(data, -20, { action: 'walk' }).index, 1);
  assert.throws(() => sampleReferenceFrame({ frames: [], actions: {} }), /no playable frames/);
});

test('baked cycles preserve their sampled duration so slow breathing is not played at the walking cadence', () => {
  const data = {
    frames: Array.from({ length: 9 }, (_, index) => ({ x: index * 288, y: 0 })),
    actions: { idle: [0, 1, 2, 3], walk: [4, 5, 6, 7], point: [8] },
    actionDurations: { idle: 4, walk: 1, point: 0 }, frameRate: 12,
  };
  assert.equal(sampleReferenceFrame(data, .3, { action: 'idle' }).index, 0);
  assert.equal(sampleReferenceFrame(data, .3, { action: 'walk' }).index, 5);
  for (const action of ['idle', 'walk']) {
    const duration = data.actionDurations[action], sequence = data.actions[action];
    for (let i = 0; i < 24; i++) {
      const time = duration * (i + .01) / sequence.length;
      assert.equal(sampleReferenceFrame(data, time, { action }).index, sequence[i % sequence.length]);
    }
    assert.equal(sampleReferenceFrame(data, duration, { action }).index, sequence[0]);
  }
  assert.equal(sampleReferenceFrame(data, 1e4, { action: 'point' }).index, 8);
  assert.equal(sampleReferenceFrame({ ...data, frameRate: NaN }, .25, { action: 'point' }).index, 8);
});

test('mouth patches follow actual speaking state and blinking leaves expression patches independent', () => {
  const names = [...referenceAvatarCapabilities.expressions, 'talk0', 'talk1', 'talk2'];
  const face = { mouth: { patches: Object.fromEntries(names.map(name => [name, { name }])) } };
  for (const emotion of referenceAvatarCapabilities.expressions) {
    for (const time of [0, .1, 1, 3, 4.55]) {
      const silent = selectReferenceFace(face, time, { emotion });
      assert.equal(silent.name, emotion);
      assert.equal(silent.patch, face.mouth.patches[emotion]);
      const speaking = selectReferenceFace(face, time, { emotion, talk: true });
      assert.match(speaking.name, /^talk[012]$/);
    }
  }
  assert.equal(selectReferenceFace(face, 0).blink, false);
  assert.equal(selectReferenceFace(face, 4.55).blink, true);
  assert.equal(selectReferenceFace(face, 4.7).blink, false);
  assert.equal(selectReferenceFace(face, 4.55, { talk: true }).patch.name.startsWith('talk'), true);
  assert.equal(selectReferenceFace(face, 0, { emotion: 'unknown' }).name, 'neutral');
});

function fakeCanvas() {
  const calls = [];
  const context = Object.fromEntries(['save', 'restore', 'translate', 'scale', 'rotate', 'setTransform', 'clearRect', 'drawImage']
    .map(method => [method, (...args) => calls.push({ method, args })]));
  return { canvas: { width: 0, height: 0, getContext: () => context }, context, calls };
}

test('happy felt expression paints independent smiling eyes while blinks keep priority and speech keeps its mouth', async () => {
  const { paintFeltDandelion } = await import('../src/components/reference-art-avatar.js');
  const patch = x => ({ x, y: 0, width: 8, height: 8 });
  const face = {
    pivot: [50, 80],
    mouth: { rect: [40, 60, 8, 8], patches: { neutral: patch(0), happy: patch(0), talk0: patch(3), talk1: patch(4), talk2: patch(5) } },
    eyes: [
      { rect: [30, 40, 8, 8], patch: patch(10), happyPatch: patch(20) },
      { rect: [60, 40, 8, 8], patch: patch(11), happyPatch: patch(21) },
    ],
  };
  const data = {
    width: 100, height: 140, frameWidth: 100, frameHeight: 140,
    frames: [{ x: 0, y: 0, pose: { rootY: 0, head: { rotation: .02 } } }],
    fit: { scale: 1, offsetX: 0, offsetY: 0 }, actions: { idle: [0] }, face,
  };
  const images = { art: {}, face: {} };
  const render = parameters => {
    const { context, calls } = fakeCanvas();
    paintFeltDandelion(context, images, data, parameters);
    return calls.filter(call => call.method === 'drawImage' && call.args[0] === images.face).map(call => call.args);
  };
  assert.deepEqual(render({ emotion: 'neutral' }).map(args => args[1]), [], 'neutral leaves the original artwork mouth untouched');
  assert.deepEqual(render({ emotion: 'happy' }).map(args => args[1]), [0, 20, 21], 'happy eyes distinguish an unchanged original smiling mouth');
  assert.deepEqual(render({ emotion: 'happy', time: 4.55 }).map(args => args[1]), [0, 10, 11], 'blink patches override the smiling eyes');
  const talking = render({ emotion: 'happy', time: .1, talk: true });
  assert.ok([3, 4, 5].includes(talking[0][1]), 'speaking mouth stays separate from smiling eyes');
  assert.deepEqual(talking.slice(1).map(args => args[1]), [20, 21]);
  assert.deepEqual(talking[1].slice(5), face.eyes[0].rect, 'eye patch uses its original-art destination rectangle');
});

test('listening leans a complete baked silhouette and face together without moving the baked head independently', async () => {
  const { paintFeltDandelion } = await import('../src/components/reference-art-avatar.js');
  const data = {
    width: 100, height: 140, frameWidth: 100, frameHeight: 140,
    fit: { scale: 1, offsetX: 0, offsetY: 0 }, actions: { idle: [0] },
    frames: [{ x: 0, y: 0, pose: { rootY: 0, head: { rotation: .002 } } }],
    face: { pivot: [50, 80], mouth: { rect: [40, 60, 8, 8], patches: { curious: { x: 0, y: 0, width: 8, height: 8 } } } },
  };
  const images = { art: {}, face: {} }, { context, calls } = fakeCanvas();
  paintFeltDandelion(context, images, data, { listen: true, emotion: 'curious' });
  const originalArtDraw = calls.findIndex(call => call.method === 'drawImage' && call.args[0] === images.art);
  const wholeArtLean = calls.findIndex(call => call.method === 'rotate' && call.args[0] === -.018);
  assert.ok(wholeArtLean >= 0 && wholeArtLean < originalArtDraw, 'listening transform includes the atlas frame');
  const rotations = calls.filter(call => call.method === 'rotate').map(call => call.args[0]);
  assert.deepEqual(rotations, [-.018, .002], 'facial patch follows the stored baked pose exactly');
  assert.equal(calls.filter(call => call.method === 'save').length, calls.filter(call => call.method === 'restore').length);
});

test('both real local artwork players load their own assets and release images and backing pixels exactly once', async () => {
  const { createWatercolorOtter, createFeltDandelion } = await import('../src/components/reference-art-avatar.js');
  const previousImage = globalThis.Image;
  const images = [];
  globalThis.Image = class {
    naturalWidth = 4096; naturalHeight = 4096; released = 0;
    constructor() { images.push(this); }
    set src(value) { this.url = value; queueMicrotask(() => this.onload?.()); }
    removeAttribute(name) { assert.equal(name, 'src'); this.released++; }
  };
  try {
    for (const [create, kind] of [[createWatercolorOtter, 'layer-rig'], [createFeltDandelion, 'atlas']]) {
      const { canvas, calls } = fakeCanvas();
      const model = await create(canvas);
      assert.match(model.metadata.renderer, new RegExp(kind));
      assert.equal(model.metadata.dimensionality, '2d');
      assert.deepEqual(model.capabilities.actions, ['idle', 'walk', 'wave', 'point']);
      assert.ok(canvas.width >= 300 && canvas.height >= 400);
      model.draw({ time: 4.55, action: 'walk', emotion: 'concerned', talk: true });
      assert.ok(calls.some(call => call.method === 'drawImage'), 'local PNG pixels are painted');
      model.dispose();
      const callsAfterDispose = calls.length;
      model.dispose(); model.draw({ time: 42, action: 'wave' });
      assert.equal(calls.length, callsAfterDispose, 'no rendering after disposal');
      assert.equal(canvas.width, 1); assert.equal(canvas.height, 1);
    }
    assert.equal(images.length, 4);
    for (const image of images) {
      assert.equal(image.released, 1);
      assert.match(image.url, /^\.\/assets\/reference-avatars\/.+\.png$/);
      assert.equal(image.onload, null); assert.equal(image.onerror, null);
    }
  } finally { globalThis.Image = previousImage; }
});

test('failed local artwork loading cleans up both the rejected image and any successfully decoded image', async () => {
  const { createWatercolorOtter } = await import('../src/components/reference-art-avatar.js');
  const previousImage = globalThis.Image;
  const images = [];
  globalThis.Image = class {
    naturalWidth = 100; naturalHeight = 100; released = 0;
    constructor() { images.push(this); }
    set src(value) { queueMicrotask(() => value.includes('otter-face') ? this.onerror?.() : this.onload?.()); }
    removeAttribute() { this.released++; }
  };
  try {
    await assert.rejects(createWatercolorOtter(fakeCanvas().canvas), /Unable to load local reference artwork/);
    assert.equal(images.length, 2);
    assert.ok(images.every(image => image.released === 1));
  } finally { globalThis.Image = previousImage; }
});

test('synchronous image assignment failures release both image requests and keep the error reviewable', async () => {
  const { createWatercolorOtter } = await import('../src/components/reference-art-avatar.js');
  const previousImage = globalThis.Image, images = [];
  globalThis.Image = class {
    released = 0;
    constructor() { images.push(this); }
    set src(_) { throw new Error('Image URL rejected by host'); }
    removeAttribute() { this.released++; }
  };
  try {
    await assert.rejects(createWatercolorOtter(fakeCanvas().canvas), /Image URL rejected by host/);
    assert.equal(images.length, 2);
    assert.ok(images.every(image => image.released === 1 && image.onload === null && image.onerror === null));
  } finally { globalThis.Image = previousImage; }
});

test('an initial canvas drawing failure releases decoded artwork and balances saved transforms', async () => {
  const { createWatercolorOtter } = await import('../src/components/reference-art-avatar.js');
  const previousImage = globalThis.Image, images = [];
  globalThis.Image = class {
    naturalWidth = 4096; naturalHeight = 4096; released = 0;
    constructor() { images.push(this); }
    set src(_) { queueMicrotask(() => this.onload?.()); }
    removeAttribute() { this.released++; }
  };
  try {
    const { canvas, context, calls } = fakeCanvas();
    context.drawImage = () => { throw new Error('Canvas failed to paint decoded image'); };
    await assert.rejects(createWatercolorOtter(canvas), /Canvas failed to paint decoded image/);
    assert.ok(images.every(image => image.released === 1));
    assert.equal(canvas.width, 1); assert.equal(canvas.height, 1);
    assert.equal(calls.filter(call => call.method === 'save').length, calls.filter(call => call.method === 'restore').length);
  } finally { globalThis.Image = previousImage; }
});
