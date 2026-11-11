import test from 'node:test';
import assert from 'node:assert/strict';
import { closedSmilePose } from '../src/components/avatar-expression.js';
import { createSvgRig2D, explorerRigMarkup } from '../src/components/explorer-avatar.js';
import { originalFoxRigMarkup } from '../src/components/original-fox-avatar.js';
import { otterRigMarkup, buildOtterRig } from '../src/components/otter-avatar.js';
import { dandelionRigMarkup, buildDandelionRig } from '../src/components/dandelion-avatar.js';

// Exercise the shared SVG driver with the real markup. This small attribute
// harness does not emulate layout, painting, browser filters or WebGL.
function svgHarness(markup, eyeY) {
  const bones = new Map([...markup.matchAll(/<[^>]*\bdata-bone="([^"]+)"[^>]*>/g)].map(match => {
    const attributes = new Map([...match[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(attribute => [attribute[1], attribute[2]]));
    return [match[1], { dataset: { bone: match[1] }, getAttribute: key => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value) }];
  }));
  const element = { style: {}, querySelectorAll: () => [...bones.values()], remove() {} };
  const previousDocument = globalThis.document;
  let rig;
  try {
    globalThis.document = { createElement: () => ({ content: { firstElementChild: element }, innerHTML: '' }) };
    rig = createSvgRig2D({ append() {} }, { markup, id: 'test', name: 'test', eyeY });
  } finally { globalThis.document = previousDocument; }
  return { rig, bones };
}

test('a reassuring smile keeps its upward curve and its centre in SVG and 3D coordinates', () => {
  for (const centerY of [13, -.11, -.245]) {
    const normal = closedSmilePose('neutral', centerY);
    const concern = closedSmilePose('concerned', centerY);
    assert.deepEqual(normal, { scaleY: 1, offsetY: 0 });
    assert.ok(concern.scaleY > 0 && concern.scaleY < normal.scaleY, 'never flip the curve into a frown');
    assert.ok(Math.abs(centerY * concern.scaleY + concern.offsetY - centerY) < 1e-12, 'keep the mouth attached to its muzzle');
  }
});

for (const [name, markup, eyeY] of [
  ['fox', originalFoxRigMarkup, -21], ['explorer', explorerRigMarkup, -18],
  ['otter', otterRigMarkup, -21], ['dandelion', dandelionRigMarkup, -13],
]) {
  test(`${name} concern preserves its own mouth shape, restores neutral and yields to speaking`, () => {
    const { rig, bones } = svgHarness(markup(), eyeY);
    const originalSmile = bones.get('smile').getAttribute('d');
    const originalBrows = bones.get('brows').getAttribute('d');
    try {
      rig.draw({ time: 1, emotion: 'concerned' });
      assert.equal(bones.get('smile').getAttribute('d'), originalSmile, 'animal mouths must not become a generic human frown');
      assert.match(bones.get('smile').getAttribute('transform'), /scale\(1 0\.32\)/);
      assert.equal(bones.get('smile').getAttribute('opacity'), '1');
      assert.equal(bones.get('brows').getAttribute('d'), originalBrows);
      assert.equal(bones.get('brows').getAttribute('transform'), 'translate(0 -1.4)');
      rig.draw({ time: 1, emotion: 'concerned', talk: true });
      assert.equal(bones.get('smile').getAttribute('opacity'), '0');
      assert.doesNotMatch(bones.get('mouth').getAttribute('transform'), /scale\(1 0\)/);
      rig.draw({ time: 1, emotion: 'curious' });
      rig.draw({ time: 1, emotion: 'neutral' });
      assert.equal(bones.get('smile').getAttribute('d'), originalSmile);
      assert.match(bones.get('smile').getAttribute('transform'), /scale\(1 1\)/);
      assert.equal(bones.get('brows').getAttribute('d'), originalBrows);
      assert.equal(bones.get('brows').getAttribute('transform'), 'translate(0 0)');
    } finally { rig.dispose(); }
  });
}

for (const [name, build] of [['otter', buildOtterRig], ['dandelion', buildDandelionRig]]) {
  test(`${name} 3D concern uses a gentle mouth and actual playback still takes priority`, () => {
    const rig = build();
    try {
      rig.draw({ time: 1, emotion: 'concerned' });
      assert.ok(rig.joints.smile.scale.y > 0, 'the smile geometry must not be inverted');
      assert.equal(rig.joints.mouth.visible, false);
      rig.draw({ time: 1, emotion: 'concerned', talk: true });
      assert.equal(rig.joints.mouth.visible, true);
      assert.equal(rig.joints.smile.visible, false);
    } finally { rig.dispose(); }
  });
}
