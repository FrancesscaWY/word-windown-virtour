import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneShareBounds, clampSceneShare, DEFAULT_SCENE_SHARE } from '../src/components/workspace-resize.js';

test('4:6 panes keep enough room for reading when the viewport shrinks', () => {
  for (const horizontal of [false, true]) for (const available of [260, 390, 700, 1400]) {
    const bounds = sceneShareBounds(available, horizontal);
    assert.ok(bounds.min >= .25 && bounds.max <= .65 && bounds.min <= .4 && bounds.max >= .4);
    assert.equal(clampSceneShare(DEFAULT_SCENE_SHARE, available, horizontal), .4);
    assert.equal(clampSceneShare(-2, available, horizontal), bounds.min);
    assert.equal(clampSceneShare(10, available, horizontal), bounds.max);
    assert.equal(clampSceneShare(NaN, available, horizontal), .4);
  }
  assert.equal(clampSceneShare(.6, 260), .4, 'small panes reserve space for the conversation');
});
