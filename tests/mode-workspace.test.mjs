import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/guide/store.js';
import { createGuideController } from '../src/guide/controller.js';
import { createTourActions } from '../src/guide/tour-actions.js';
import { createMovementTrail, modeLayout, modeHint, contextualPrompt, createRecommendationState, INTERACTIVE_GREETING, COMPANION_GREETING } from '../src/components/mode-workspace.js';

test('recommendation targets explicit offers and dismissal survives unrelated updates until a new offer', () => {
  const recommendation = createRecommendationState();
  const state = createStore({ mentionedPoiId:'arc', recommendedPoiIds:['eiffel'] }).get();
  assert.equal(recommendation.update(state).poiId, 'eiffel');
  assert.equal(recommendation.dismiss(state), 'eiffel');
  assert.equal(recommendation.update({ ...state, guideStatus:'idle' }).hidden, true);
  assert.equal(recommendation.update({ ...state, recommendedPoiIds:['eiffel'] }).hidden, false);
  recommendation.dismiss(state);
  assert.equal(recommendation.update({ ...state, recommendedPoiIds:[], mentionedPoiId:'eiffel' }).hidden, true);
  assert.equal(recommendation.update({ ...state, recommendedPoiIds:[], mentionedPoiId:'arc' }).hidden, false);
});

test('map conversation floats chat above the map while immersive and companion keep their layouts', () => {
  const state = createStore().get();
  assert.equal(modeLayout(state), 'map-chat');
  assert.equal(modeLayout({ ...state, interactionInput:'text' }), 'map-chat');
  for (const interactionInput of ['voice', 'text']) {
    assert.equal(modeLayout({ ...state, interactionInput, tourMode:'immersive' }), 'split');
    assert.equal(modeLayout({ ...state, interactionInput, tourMode:'companion' }), 'map');
  }
  assert.match(modeHint(state), /打字或语音/);
  assert.equal(modeHint({ ...state, tourMode:'companion' }), COMPANION_GREETING);
  assert.equal(modeHint({ ...state, tourMode:'immersive' }), '打字和我聊聊');
  assert.match(contextualPrompt({ ...state, mentionedPoiId:'arc' }).text, /凯旋门/);
});

test('movement trail rejects invalid and repeated fixes, separates jumps and never mixes simulated with GPS', () => {
  const trail = createMovementTrail({ limit:4 });
  assert.equal(trail.add({ x:10, y:20 }, '模拟定位'), true);
  assert.equal(trail.add({ x:10.01, y:20.01 }, '模拟定位'), false);
  trail.add({ x:11, y:21 }, '模拟定位');
  assert.match(trail.paths()[0], /^M10\.000,20\.000 L11\.000,21\.000$/);
  trail.add({ x:80, y:80 }, '模拟定位');
  assert.equal(trail.paths().length, 2, 'teleporting must not paint a walked line across the park');
  for (const point of [{ x:NaN, y:1 }, { x:101, y:2 }, { x:3, y:-1 }]) assert.equal(trail.add(point, '模拟定位'), false);
  assert.equal(trail.paths().length, 2);
  trail.add({ x:80, y:81 }, '手机定位');
  assert.deepEqual(trail.paths(), ['M80.000,81.000']);
  for (let y = 82; y <= 90; y++) trail.add({ x:80, y }, '手机定位');
  assert.equal(trail.paths().join(' ').match(/[ML]/g).length, 4);
  trail.clear(); assert.deepEqual(trail.paths(), []);
});

test('companion scenery and detail requests speak locally without opening another visual surface or waiting for it', async () => {
  const store = createStore({ tourMode:'companion' }), spoken = [];
  const guide = createGuideController({ store, actions:createTourActions(store), speech:{ stop() {}, speak(text) { spoken.push(text); return Promise.resolve({ status:'success' }); } } });
  for (const text of ['带我看铁塔', '展开详情', '介绍凯旋门']) {
    await guide.submit(text);
    assert.equal(store.get().view, 'map');
    assert.equal(store.get().detailsOpen, false);
    assert.equal(store.get().pendingNarration, null);
  }
  assert.equal(spoken.length, 3);
  assert.match(spoken[0], /塔/);
  assert.match(spoken[2], /凯旋门/);
  guide.dispose();
});
