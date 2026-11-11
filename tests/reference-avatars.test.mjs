import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../src/vendor/three.module.js';
import { GUIDES, companionMarkup } from '../src/components/companion-demo.js';
import { otterRigMarkup, buildOtterRig } from '../src/components/otter-avatar.js';
import { dandelionRigMarkup, buildDandelionRig } from '../src/components/dandelion-avatar.js';

test('every selectable guide has exactly one matching render surface and existing guides remain available', () => {
  const markup = companionMarkup();
  assert.deepEqual(Object.keys(GUIDES), ['otter-watercolor', 'dandelion-felt', 'fox-2d', 'fox-3d', 'explorer-2d', 'explorer-3d', 'otter-2d', 'otter-3d', 'dandelion-2d', 'dandelion-3d', '2d', '3d']);
  const surfaces = new Set();
  for (const [id, guide] of Object.entries(GUIDES)) {
    assert.equal(typeof guide.create, 'function');
    assert.equal(surfaces.has(guide.surface), false, 'two guides must not share a mutable surface');
    surfaces.add(guide.surface);
    const tags = [...markup.matchAll(new RegExp(`<([a-z]+)[^>]*\\bid="${guide.surface}"[^>]*>`, 'g'))];
    assert.equal(tags.length, 1, `${id} must have one mount target`);
    assert.equal(tags[0][1], guide.tech === '2D' && id !== '2d' ? 'span' : 'canvas');
    assert.equal(/\shidden(?:\s|>)/.test(tags[0][0]), id !== 'otter-watercolor');
    assert.ok(tags[0][0].includes(guide.name));
  }
});

for (const [name, markup] of [['otter', otterRigMarkup], ['dandelion', dandelionRigMarkup]]) {
  test(`${name} SVG contains distinct animated body and facial joints without external artwork`, () => {
    const svg = markup();
    const bones = [...svg.matchAll(/data-bone="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(bones).size, bones.length, 'joint names must be unambiguous');
    for (const bone of ['root', 'head', 'eyes', 'brows', 'smile', 'mouth', 'armL', 'armR', 'elbowL', 'elbowR', 'legL', 'legR', 'kneeL', 'kneeR']) assert.ok(bones.includes(bone), bone);
    const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    for (const match of svg.matchAll(/url\(#([^\)]+)\)/g)) assert.ok(ids.includes(match[1]), `missing paint ${match[1]}`);
    assert.doesNotMatch(svg, /<image\b|<script\b|(?:href|src)="https?:/);
    assert.match(svg, /data-bone="mouth"[^>]*scale\(1 0\)/, 'default static portrait should have a closed mouth');
  });
}

for (const [name, build] of [['otter', buildOtterRig], ['dandelion', buildDandelionRig]]) {
  test(`${name} is articulated volumetric geometry with bounded motion and visible facial changes`, () => {
    const rig = build();
    try {
      const geometries = new Set(); let triangles = 0;
      rig.root.traverse(object => {
        if (!object.isMesh) return;
        const positions = object.geometry.getAttribute('position');
        geometries.add(object.geometry);
        triangles += (object.geometry.index?.count ?? positions.count) / 3;
      });
      assert.ok(triangles > 1000 && triangles < 65000, `small character geometry budget: ${triangles}`);
      for (const geometry of geometries) {
        assert.ok([...geometry.getAttribute('position').array].every(Number.isFinite));
      }
      for (const action of ['idle', 'walk', 'wave', 'point', 'turn']) {
        for (const time of [.31, 1, 2.7]) {
          rig.draw({ action, time, emotion: 'neutral' }); rig.root.updateMatrixWorld(true);
          const size = new THREE.Box3().setFromObject(rig.root, true).getSize(new THREE.Vector3());
          assert.ok(size.toArray().every(value => Number.isFinite(value) && value > .1));
          assert.ok(size.x < 3 && size.y < 4.4 && size.z < 3, `${action} unexpectedly escaped its display area`);
        }
      }
      rig.draw({ time: 1, action: 'idle', emotion: 'neutral' });
      const idleArm = rig.joints.armL.rotation.z;
      const neutralEye = rig.joints.eyes[0].scale.y;
      assert.equal(rig.joints.mouth.visible, false);
      rig.draw({ time: 1, action: 'wave', emotion: 'happy' });
      assert.ok(Math.abs(rig.joints.armL.rotation.z - idleArm) > 1);
      assert.notEqual(rig.joints.eyes[0].scale.y, neutralEye);
      rig.draw({ time: 1, emotion: 'curious' });
      assert.equal(rig.joints.mouth.visible, true);
      rig.draw({ time: 1, talk: true }); const mouth = rig.joints.mouth.scale.y;
      rig.draw({ time: 1.1, talk: true });
      assert.notEqual(rig.joints.mouth.scale.y, mouth, 'actual playback state drives changing mouth shape');
      rig.draw({ time: 1, action: 'turn', turn: Math.PI });
      assert.equal(rig.root.rotation.y, Math.PI);
      const before = rig.root.rotation.y;
      rig.dispose(); rig.draw({ time: 2, turn: 0 });
      assert.equal(rig.root.rotation.y, before, 'disposed models must stop updating');
    } finally { rig.dispose(); }
  });

  test(`${name} releases its model geometry, materials and textures exactly once`, () => {
    const rig = build(); const resources = new Set();
    rig.scene.traverse(object => {
      if (object.geometry) resources.add(object.geometry);
      for (const material of (Array.isArray(object.material) ? object.material : [object.material]).filter(Boolean)) {
        resources.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
      }
    });
    for (const geometry of rig.geometries ?? []) resources.add(geometry);
    const events = new Map([...resources].map(resource => [resource, 0]));
    for (const resource of resources) resource.addEventListener('dispose', () => events.set(resource, events.get(resource) + 1));
    rig.dispose(); rig.dispose();
    assert.ok(resources.size > 30);
    assert.ok([...events.values()].every(count => count === 1));
  });
}
