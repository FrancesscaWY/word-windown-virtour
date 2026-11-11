import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/guide/store.js';
import { createTourActions } from '../src/guide/tour-actions.js';
import { createGuideController } from '../src/guide/controller.js';
import { resolveLocalIntent } from '../src/guide/intent.js';
import { getPoi, panoramaHotspots, detailSections } from '../src/data/pois.js';

const tick = () => Promise.resolve();
const eiffel = getPoi('eiffel');
const eiffelHotspot = panoramaHotspots.eiffel?.[0] ?? null;
const detailId = eiffelHotspot?.id ?? null;
const openingNarration = eiffel.panoramaNarration ?? '抬头看看，塔身的交叉线条一路伸向塔尖。这是原创示意场景，向下拖，还能发现花园步道。';
const detailBody = eiffelHotspot?.body ?? detailSections.eiffel?.[0]?.text ?? eiffel.summary;

test('every guide name preserves stop and contextual commands', () => {
  for (const name of ['小旅', '星遥', '沐沐', '绒绒', '汪可', '赤狐']) {
    assert.deepEqual(resolveLocalIntent(`${name}，停一下`), resolveLocalIntent('停一下'));
    assert.deepEqual(resolveLocalIntent(`${name}，它远不远`, { mentionedPoiId:'eiffel' }), resolveLocalIntent('它远不远', { mentionedPoiId:'eiffel' }));
  }
});
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture({ seed = {}, resolver } = {}) {
  const store = createStore(seed);
  const actions = createTourActions(store);
  const calls = [];
  let stops = 0;
  const speech = { stop() { stops += 1; }, speak(text, callbacks) { callbacks?.onStart?.(); const pending = deferred(); calls.push({ text, ...pending }); return pending.promise; } };
  const controller = createGuideController({ store, actions, speech, resolveIntent: resolver });
  return { store, actions, controller, calls, get stops() { return stops; } };
}

test('recommendation navigation opens the target and conversation while retaining scene-ready narration', () => {
  const f = fixture({ seed:{ mentionedPoiId:'arc', tourMode:'immersive' } });
  assert.equal(f.controller.openPoiWithDetails('eiffel'), true);
  assert.equal(f.store.get().selectedPoiId, 'eiffel');
  assert.equal(f.store.get().view, 'panorama');
  assert.equal(f.store.get().detailsOpen, false);
  assert.equal(f.store.get().pendingNarration.id, 'eiffel');
  assert.equal(f.controller.whenSceneReady('eiffel'), true);
  assert.equal(f.store.get().pendingNarration, null);
  assert.equal(f.store.get().detailsOpen, false);
  assert.equal(f.calls.length, 0, 'text mode must not play speech');
  const before = f.store.get();
  assert.equal(f.controller.openPoiWithDetails('missing'), false);
  assert.equal(f.store.get(), before);
  f.controller.dispose();
});

test('dismissing a recommendation clears its pending confirmation without navigating or adding messages', async () => {
  const f = fixture({ seed:{ tourMode:'immersive' } });
  await f.controller.submit('推荐一处风景');
  const before = f.store.get(), id = before.recommendedPoiIds[0];
  assert.ok(id);
  f.controller.dismissRecommendation(id);
  const after = f.store.get();
  assert.deepEqual(after.recommendedPoiIds, []);
  assert.equal(after.clarification, null);
  assert.deepEqual(after.suggestions, []);
  assert.equal(after.view, before.view);
  assert.equal(after.selectedPoiId, before.selectedPoiId);
  assert.equal(after.messages, before.messages);
  f.controller.dispose();
});

test('immersive mode keeps written narration silent and voice resumes after switching modes', async () => {
  const f = fixture({ seed: { tourMode: 'immersive' } });
  await f.controller.submit('介绍铁塔');
  f.controller.whenSceneReady('eiffel');
  assert.ok(f.store.get().guideText);
  assert.equal(f.calls.length, 0);
  assert.equal(f.store.get().guideStatus, 'idle');
  f.store.set({ tourMode: 'interactive' });
  f.controller.resumeNarration();
  assert.equal(f.calls.length, 1);
  f.controller.dispose();
});

test('interactive text exchange stays silent and switching back restores voice narration', async () => {
  const f = fixture({ seed: { tourMode: 'interactive', interactionInput: 'text' } });
  await f.controller.submit('介绍铁塔');
  f.controller.whenSceneReady('eiffel');
  assert.ok(f.store.get().guideText.includes('铁塔'));
  assert.equal(f.calls.length, 0);
  assert.equal(f.store.get().guideStatus, 'idle');
  f.store.set({ interactionInput: 'voice' });
  f.controller.resumeNarration();
  assert.equal(f.calls.length, 1);
  f.controller.dispose();
});

test('default visible selection never substitutes for an unresolved conversation pronoun', async () => {
  const f = fixture();
  await f.controller.submit('它远不远？');
  assert.equal(f.store.get().view, 'map');
  assert.equal(f.store.get().selectedPoiId, 'eiffel');
  assert.equal(f.store.get().mentionedPoiId, null);
  assert.equal(f.store.get().visitInfo, null);
  assert.equal(f.store.get().clarification.pendingIntent.type, 'distance');
  await f.controller.submit('凯旋门');
  assert.equal(f.store.get().selectedPoiId, 'eiffel', 'clarifying distance must not select or open that scene');
  assert.equal(f.store.get().mentionedPoiId, 'arc');
  assert.equal(f.store.get().visitInfo.id, 'arc');
  assert.match(f.store.get().guideText, /不能估算距离/);
});

test('distance and crowd answers use the topic independently of the visible selection and real visitor origin', async () => {
  const f = fixture();
  await f.controller.submit('凯旋门远不远');
  assert.equal(f.store.get().view, 'map');
  assert.equal(f.store.get().selectedPoiId, 'eiffel');
  assert.equal(f.store.get().mentionedPoiId, 'arc');
  assert.deepEqual(f.store.get().visitInfo, { id: 'arc', region: '欧洲区', source: '尚无实时数据' });
  assert.match(f.store.get().guideText, /实拍/);
  assert.match(f.store.get().guideText, /还没有/);
  await f.controller.submit('它排队多久');
  assert.equal(f.store.get().visitInfo.id, 'arc');
  assert.match(f.store.get().guideText, /没有实时人流/);
  assert.match(f.store.get().guideText, /不能判断/);
  assert.equal(f.store.get().visitorOrigin, null);
  assert.equal(f.store.get().selectedPoiId, 'eiffel');
});

test('distance and crowd queries close obsolete hotspot details without changing the visible panorama or selection', async () => {
  for (const input of ['凯旋门远不远', '凯旋门人多吗']) {
    const f = fixture();
    f.controller.openPoi('eiffel');
    f.controller.whenSceneReady('eiffel');
    assert.equal(f.controller.showDetails(detailId), true);
    assert.equal(f.store.get().detailsOpen, false);
    assert.equal(f.store.get().activeHotspotId, detailId);
    await f.controller.submit(input);
    assert.equal(f.store.get().detailsOpen, false, input);
    assert.equal(f.store.get().activeHotspotId, null, input);
    assert.equal(f.store.get().view, 'panorama', input);
    assert.equal(f.store.get().selectedPoiId, 'eiffel', input);
    assert.equal(f.store.get().mentionedPoiId, 'arc', input);
    assert.equal(f.store.get().visitInfo.id, 'arc', input);
    assert.equal(f.store.get().visitInfo.distanceMeters, undefined, input);
    assert.equal(f.store.get().visitInfo.source, '尚无实时数据', input);
    assert.match(f.store.get().guideText, /凯旋门/);
  }
});

test('opening a panorama waits for its matching ready event before narrating, and only narrates once', async () => {
  const f = fixture();
  await f.controller.submit('带我看看铁塔');
  assert.equal(f.store.get().view, 'panorama');
  assert.equal(f.store.get().pendingNarration.id, 'eiffel');
  assert.equal(f.store.get().guideStatus, 'waiting');
  assert.equal(f.calls.length, 0);
  assert.equal(f.controller.whenSceneReady('arc'), false);
  assert.equal(f.calls.length, 0);
  assert.equal(f.controller.whenSceneReady('eiffel'), true);
  assert.equal(f.calls.length, 1);
  assert.equal(f.store.get().pendingNarration, null);
  assert.equal(f.calls[0].text, openingNarration);
  assert.equal(f.controller.whenSceneReady('eiffel'), false);
  assert.equal(f.calls.length, 1);
});

test('click and introduction commands enter through the same queue, including already-ready scenes', async () => {
  const f = fixture();
  assert.equal(f.controller.openPoi('eiffel'), true);
  f.controller.whenSceneReady('eiffel');
  assert.equal(f.calls.length, 1);
  await f.controller.submit('介绍铁塔');
  assert.equal(f.calls.length, 2, 'reopening the same ready scene must not wait for a nonexistent reload');
  assert.equal(f.store.get().guideStatus, 'speaking');
  assert.equal(f.store.get().pendingNarration, null);
});

test('a point without panorama honestly stays on the map and replies without impersonating a loaded scene', async () => {
  const f = fixture();
  await f.controller.submit('我想看泰姬陵全景');
  assert.equal(f.store.get().view, 'map');
  assert.equal(f.store.get().selectedPoiId, 'taj');
  assert.equal(f.store.get().detailsOpen, false);
  assert.equal(f.store.get().pendingNarration, null);
  assert.match(f.store.get().guideText, /泰姬陵/);
  assert.equal(f.calls.length, 1);
});

test('a configured hotspot or general detail and a follow-up building story enter the same conversation', async () => {
  const f = fixture();
  f.controller.openPoi('eiffel');
  f.controller.whenSceneReady('eiffel');
  assert.equal(f.controller.showDetails(detailId), true);
  assert.equal(f.store.get().activeHotspotId, detailId);
  assert.equal(f.store.get().detailsOpen, false);
  assert.ok(f.store.get().guideText.includes(detailBody));
  await f.controller.submit('这个建筑有什么故事');
  assert.equal(f.store.get().activeHotspotId, detailId);
  assert.equal(f.store.get().view, 'panorama');
  assert.equal(f.store.get().detailsOpen, false);
  assert.equal(f.store.get().mentionedPoiId, eiffel.id);
  assert.ok(f.store.get().guideText.includes(detailBody));
  if (eiffelHotspot) assert.ok(f.store.get().guideText.includes(eiffelHotspot.title));
  else assert.ok(f.store.get().guideText.includes(eiffel.name));
});

test('multiple landmarks require one choice and carry the original pending request through clarification', async () => {
  const f = fixture();
  await f.controller.submit('铁塔和凯旋门远不远');
  assert.deepEqual(f.store.get().clarification.candidates, ['eiffel', 'arc']);
  assert.equal(f.store.get().clarification.pendingIntent.type, 'distance');
  assert.equal(f.store.get().view, 'map');
  await f.controller.submit('好');
  assert.equal(f.store.get().clarification.candidates.length, 2);
  assert.equal(f.store.get().visitInfo, null);
  await f.controller.submit('凯旋门');
  assert.equal(f.store.get().visitInfo.id, 'arc');
  assert.equal(f.store.get().selectedPoiId, 'eiffel');
});

test('unknown places, unsupported questions and negated travel commands do not silently navigate', async () => {
  for (const input of ['带我去天坛', '不要去凯旋门', '不是铁塔是凯旋门', '不介绍凯旋门', '别给我介绍凯旋门', '我不想了解凯旋门', '带我去铁塔和天坛', '铁塔天气怎么样', '我想知道铁塔门票', '随便执行一些操作']) {
    const f = fixture();
    await f.controller.submit(input);
    assert.equal(f.store.get().view, 'map', input);
    assert.equal(f.store.get().selectedPoiId, 'eiffel', input);
    assert.equal(f.store.get().pendingNarration, null, input);
  }
  assert.equal(resolveLocalIntent('铁塔远不远').type, 'distance', 'question negation is not a refusal');
  const f = fixture();
  f.controller.openPoi('eiffel');
  await f.controller.submit('不要返回地图');
  assert.equal(f.store.get().view, 'panorama', 'a negated map command must preserve the current scene');
});

test('unknown explicit names cannot borrow a previous topic in distance, crowd or story questions', async () => {
  for (const input of ['天坛远吗', '未收录钟楼人多吗', '天坛离这里远吗', 'A景点远不远', '天坛有什么故事']) {
    const f = fixture();
    await f.controller.submit('铁塔远吗');
    await f.controller.submit(input);
    assert.equal(f.store.get().clarification.kind, 'unknown-poi', input);
    assert.equal(f.store.get().visitInfo, null, input);
    assert.equal(f.store.get().selectedPoiId, 'eiffel', input);
    assert.equal(f.store.get().view, 'map', input);
    assert.equal(f.store.get().mentionedPoiId, 'eiffel', input);
  }
  const active = fixture();
  active.controller.openPoi('eiffel');
  assert.equal(active.controller.showDetails(detailId), true);
  assert.equal(active.store.get().detailsOpen, false);
  assert.equal(active.store.get().activeHotspotId, detailId);
  await active.controller.submit('天坛有什么故事');
  assert.equal(active.store.get().clarification.kind, 'unknown-poi', 'an active hotspot or general detail also cannot swallow an unknown explicit target');
  await active.controller.submit('它远吗');
  assert.ok(active.store.get().clarification, 'an unresolved unknown target must remain unresolved for a pronoun follow-up');
  assert.equal(active.store.get().visitInfo, null);
  await active.controller.submit('凯旋门');
  assert.equal(active.store.get().visitInfo.id, 'arc', 'the later explicit choice still completes the pending distance request');
});

test('elliptical named follow-ups inherit the query, update topic, and then show the new building story', async () => {
  const f = fixture();
  await f.controller.submit('铁塔远吗');
  await f.controller.submit('凯旋门呢');
  assert.equal(f.store.get().lastIntent.type, 'distance');
  assert.equal(f.store.get().visitInfo.id, 'arc');
  assert.equal(f.store.get().selectedPoiId, 'eiffel');
  assert.equal(f.store.get().view, 'map');
  await f.controller.submit('它有什么故事');
  assert.equal(f.store.get().selectedPoiId, 'arc');
  assert.equal(f.store.get().mentionedPoiId, 'arc');
  assert.equal(f.store.get().detailsOpen, false);
  assert.match(f.store.get().guideText, /凯旋门/);
  const crowd = fixture();
  await crowd.controller.submit('铁塔人多吗');
  await crowd.controller.submit('凯旋门呢');
  assert.equal(crowd.store.get().lastIntent.type, 'crowd');
  assert.equal(crowd.store.get().visitInfo.id, 'arc');
  await crowd.controller.submit('看看铁塔');
  assert.equal(crowd.store.get().view, 'panorama', 'an explicit new opening command overrides the last distance/crowd intent');
});

test('punctuation-only submissions are empty and do not interrupt, speak or alter state', async () => {
  const f = fixture();
  f.controller.openPoi('eiffel');
  const before = f.store.get();
  const stops = f.stops;
  for (const input of ['！？。', ' ... ', '——', '，；：']) assert.equal((await f.controller.submit(input)).status, 'empty');
  assert.equal(f.store.get(), before);
  assert.equal(f.stops, stops);
  assert.equal(f.calls.length, 0);
});

test('recommendations ask permission through conversation and confirmation opens that one suggested scene', async () => {
  const f = fixture();
  await f.controller.submit('第一次来推荐哪里');
  assert.equal(f.store.get().view, 'map');
  assert.deepEqual(f.store.get().recommendedPoiIds, ['eiffel']);
  assert.equal(f.store.get().clarification.kind, 'confirm-recommendation');
  await f.controller.submit('可以');
  assert.equal(f.store.get().view, 'panorama');
  assert.equal(f.store.get().pendingNarration.id, 'eiffel');
  assert.equal(f.store.get().clarification, null);
  const fresh = fixture();
  await fresh.controller.submit('好');
  assert.equal(fresh.store.get().view, 'map', 'an acknowledgment without a proposal is never navigation');
});

test('refusing a recommendation clears it and never opens the default selected point', async () => {
  const f = fixture();
  await f.controller.submit('推荐');
  await f.controller.submit('不用了');
  assert.equal(f.store.get().view, 'map');
  assert.equal(f.store.get().clarification, null);
  assert.deepEqual(f.store.get().recommendedPoiIds, []);
  assert.equal(f.store.get().pendingNarration, null);
});

test('map, interruption and stop cancel pending narration and ignore late scene or speech completion', async () => {
  for (const method of ['showMap', 'interrupt', 'stop']) {
    const f = fixture();
    f.controller.openPoi('eiffel');
    f.controller[method]();
    const count = f.calls.length;
    f.controller.whenSceneReady('eiffel');
    assert.equal(f.calls.length, count, method);
    assert.equal(f.store.get().pendingNarration, null);
  }
  const f = fixture();
  f.controller.openPoi('eiffel');
  f.controller.whenSceneReady('eiffel');
  const old = f.calls[0];
  await f.controller.submit('铁塔距离多少');
  assert.equal(f.store.get().guideStatus, 'speaking');
  old.resolve({ status: 'success' });
  await tick();
  assert.equal(f.store.get().guideStatus, 'speaking', 'old speech must not end a newer narration');
});

test('scene failure cancels queued speech and reports text while a retry can be narrated', async () => {
  const f = fixture();
  f.controller.openPoi('eiffel');
  f.controller.whenSceneFailed('eiffel');
  assert.equal(f.store.get().pendingNarration, null);
  assert.equal(f.calls.length, 0);
  assert.match(f.store.get().guideText, /暂时没加载/);
  f.controller.whenSceneReady('eiffel');
  assert.equal(f.calls.length, 0, 'a cancelled pending narration does not start after a late recovery');
  f.controller.resumeNarration();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].text, openingNarration);
});

test('asynchronous resolvers are last-command-wins, including explicit stop and disposal', async () => {
  const old = deferred();
  const f = fixture({ resolver: text => text === '旧指令' ? old.promise : resolveLocalIntent(text) });
  const pending = f.controller.submit('旧指令');
  await f.controller.submit('带我看看铁塔');
  old.resolve({ type: 'open-poi', poiId: 'arc' });
  assert.equal((await pending).status, 'cancelled');
  assert.equal(f.store.get().selectedPoiId, 'eiffel');
  assert.equal(f.store.get().pendingNarration.id, 'eiffel');
  for (const method of ['interrupt', 'stop', 'dispose']) {
    const result = deferred();
    const another = fixture({ resolver: () => result.promise });
    const request = another.controller.submit('带我看看铁塔');
    another.controller[method]();
    result.resolve({ type: 'open-poi', poiId: 'eiffel' });
    assert.equal((await request).status, 'cancelled');
    assert.equal(another.store.get().view, 'map');
  }
});

test('resolver and speech failures keep the guide usable and display truthful text errors', async () => {
  const f = fixture({ resolver: () => { throw new Error('deliberate failure'); } });
  assert.equal((await f.controller.submit('带我看看铁塔')).status, 'error');
  assert.equal(f.store.get().guideStatus, 'idle');
  assert.ok(f.store.get().guideError);
  const another = fixture();
  await another.controller.submit('铁塔远吗');
  another.calls[0].reject(new Error('voice failed'));
  await tick();
  assert.equal(another.store.get().guideStatus, 'idle');
  assert.match(another.store.get().guideError, /文字讲解已显示/);
});

test('bounded messages and explicit unsupported save keep the local-rules contract honest', async () => {
  const f = fixture();
  for (let i = 0; i < 10; i++) await f.controller.submit('铁塔远吗');
  assert.equal(f.store.get().messages.length, 12);
  assert.ok(f.store.get().messages.every(message => message.content === message.text));
  await f.controller.submit('保存图片到本地');
  assert.match(f.store.get().guideText, /还不能代你保存/);
  assert.equal(f.store.get().mode, 'local-rules');
  assert.equal(f.store.get().visitorOrigin, null);
  f.controller.dispose();
  assert.equal((await f.controller.submit('带我看看铁塔')).status, 'disposed');
});
