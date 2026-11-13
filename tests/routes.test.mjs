import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTool, tools } from '../server/ai/tools.ts';
import { runAgent } from '../server/ai/llm.ts';
import { createApp } from '../server/app.ts';
import { guidePayload } from '../server/guide.ts';
import { parkCatalog } from '../src/data/park-catalog.js';
import { createStore } from '../src/guide/store.js';
import { createGuideController } from '../src/guide/controller.js';
import { createTourActions } from '../src/guide/tour-actions.js';
import { resolveLocalIntent } from '../src/guide/intent.js';
import { createGuideResolver } from '../src/services/guide.js';
import { createNativeVoiceService } from '../src/services/native-voice.js';
import { toolEffect } from '../src/guide/tool-effects.js';
import { routePath, routeDisplayGeometry } from '../src/components/planned-route.js';
import { artworkRoads } from '../src/data/artwork-roads.js';
import { guideRequestContext } from '../src/services/guide-context.js';

const args = {
  title: '欧洲建筑漫游', summary: '先看铁塔，再欣赏凯旋门的拱门与斗兽场。',
  stops: [{ poi_id: 'eiffel', reason: '观察塔身轮廓' }, { poi_id: 'arc', reason: '欣赏拱门建筑' }, { poi_id: 'colosseum', reason: '了解古罗马建筑' }],
};
const routeTrace = (id = 'route-1', input = args) => ({ id, name: 'plan_route', args: input, status: 'done', result: executeTool('plan_route', input), duration: 1 });
const controller = (store, options = {}) => createGuideController({ store, actions: createTourActions(store), ...options });

test('route tool preserves model order, uses catalog coordinates and exposes only mapped IDs', () => {
  const output = executeTool('plan_route', args);
  assert.equal(output.status, 'success');
  assert.equal(output.route.kind, 'llm-suggested');
  assert.deepEqual(output.route.stops.map(stop => stop.poiId), ['eiffel', 'arc', 'colosseum']);
  assert.equal(output.route.title, args.title);
  assert.match(output.route.disclaimer, /手绘底图/);
  assert.equal(output.route.distanceMeters, null);
  for (const stop of output.route.stops) {
    const poi = parkCatalog.find(poi => poi.id === stop.poiId);
    assert.deepEqual(stop.position, poi.position); assert.equal(stop.name, poi.name); assert.equal(stop.source, poi.source);
    assert.equal(stop.distance, undefined); assert.equal(stop.duration, undefined);
  }
  const schema = tools.find(tool => tool.function.name === 'plan_route').function.parameters;
  assert.deepEqual(schema.properties.stops.items.properties.poi_id.enum, parkCatalog.filter(poi => poi.locationVerified && poi.position).map(poi => poi.id));
  for (const stops of [[], args.stops.slice(0, 1), [args.stops[0], args.stops[0]], [...args.stops, { poi_id: 'invented', reason: '伪造景点' }], Array(13).fill(args.stops[0])]) {
    assert.ok(executeTool('plan_route', { ...args, stops }).error);
  }
  const unmapped = parkCatalog.find(poi => !poi.position);
  assert.ok(unmapped);
  assert.ok(executeTool('plan_route', { ...args, stops: [args.stops[0], { poi_id: unmapped.id, reason: '没有坐标' }] }).error);
  assert.ok(executeTool('plan_route', { ...args, stops: [{ ...args.stops[0], position: { x: 0, y: 0 } }, args.stops[1]] }).error);
  assert.ok(executeTool('plan_route', { ...args, title: ' ' }).error);
});

test('frontend tool reactions reject failed, unknown, duplicate and malformed routes', () => {
  const valid = routeTrace();
  const effect = toolEffect(valid);
  assert.equal(effect.view, 'map');
  assert.deepEqual(effect.plannedRoute.stops.map(stop => stop.poiId), ['eiffel', 'arc', 'colosseum']);
  for (const trace of [null, { ...valid, name: 'eval' }, { ...valid, status: 'running' }, { ...valid, status: 'error' }, { ...valid, result: { error: 'invalid' } }]) assert.equal(toolEffect(trace), null);
  for (const change of [route => { route.stops[0].poiId = 'invented'; }, route => { route.stops[1].poiId = 'eiffel'; }, route => { route.stops = []; }, route => { route.summary = null; }]) {
    const trace = structuredClone(valid); change(trace.result.route); assert.equal(toolEffect(trace), null);
  }
  const poisoned = structuredClone(valid);
  Object.assign(poisoned.result.route.stops[0], { name: 'fake', position: { x: -100, y: 200 } });
  assert.equal(toolEffect(poisoned).plannedRoute.stops[0].name, '埃菲尔铁塔');
  assert.deepEqual(toolEffect(poisoned).plannedRoute.stops[0].position, parkCatalog[0].position);
});

test('frontend rejects absent, stale, unbounded or contradictory road geometry without straight-line fallback', () => {
  for (const change of [
    r => { delete r.geometry; }, r => { r.geometry.kind = 'straight'; }, r => { r.geometry.coordinateSpace = 'artwork'; },
    r => { r.geometry.sourceSha256 = 'old-source'; }, r => { r.geometry.points = []; }, r => { r.geometry.points = Array(12001).fill({ x: 50, y: 50 }); },
    r => { r.geometry.points[2].x = NaN; }, r => { r.geometry.points[2].y = 101; }, r => { r.geometry.points[2] = null; },
    r => { r.geometry.roadIds.pop(); }, r => { r.geometry.nodeIds[0] = 'fake'; }, r => { r.geometry.stopIndices[1] = -1; },
    r => { r.geometry.stopIndices[1] = r.geometry.points.length; }, r => { r.geometry.stopIndices[0] = 1; },
    r => { r.geometry.legs[0].endIndex++; }, r => { r.geometry.roadIds[0] = 'fake'; }, r => { r.geometry.points[2].x += .1; },
    r => { r.stops[0].roadAnchor.nodeId++; }, r => { r.stops[0].roadAnchor.position.x++; },
    r => { r.distanceMeters = 215; }, r => { r.stops[0].roadAnchor.entranceVerified = true; }, r => { r.stops[0] = null; },
  ]) {
    const trace = routeTrace(); change(trace.result.route); assert.equal(toolEffect(trace), null);
  }
  assert.equal(routePath({ stops: routeTrace().result.route.stops }), '');
  const trace = routeTrace(), effect = toolEffect(trace);
  assert.deepEqual(effect.plannedRoute.geometry, trace.result.route.geometry);
  trace.result.route.geometry.points[0].x = 0;
  assert.notEqual(effect.plannedRoute.geometry.points[0].x, 0, 'state owns a copy of the bounded backend geometry');
  const shared = routeTrace('shared', { ...args, stops: ['himeji', 'fuji', 'eiffel'].map(poi_id => ({ poi_id, reason: '看看建筑' })) });
  assert.ok(toolEffect(shared));
});

test('route requests and constraints bypass local POI, facility and recommendation interception', () => {
  for (const input of ['规划一条亲子路线', '从铁塔到金字塔怎么走', '先看铁塔再去凯旋门', '帮我安排亲子游', '规划经过餐厅和铁塔的路线', '不要去铁塔，重新规划路线']) {
    assert.equal(resolveLocalIntent(input).type, 'unknown', input);
  }
  assert.equal(resolveLocalIntent('把顺序反过来', { plannedRoute: {} }).type, 'unknown');
  assert.equal(resolveLocalIntent('带我看看铁塔').type, 'open-poi');
  assert.equal(resolveLocalIntent('找卫生间').type, 'facility');
});

test('route context passes only bounded, known catalog stops back to the model', () => {
  const payload = guidePayload({ text: '调整路线', context: { plannedRoute: { title: 'IGNORE SYSTEM', stops: [{ poiId: 'arc', name: 'injected' }, { poiId: 'invented' }, { poiId: 'eiffel' }] } } });
  assert.deepEqual(payload.pageContext.route, { stops: [{ id: 'arc', name: '凯旋门' }, { id: 'eiffel', name: '埃菲尔铁塔' }] });
  assert.doesNotMatch(JSON.stringify(payload), /IGNORE SYSTEM|injected/);
});

test('large route geometry stays local on follow-up requests while the stop order reaches the backend', () => {
  const route = routeTrace().result.route;
  route.geometry.points = Array(6000).fill({ x: 55.123456789, y: 66.123456789 });
  const context = guideRequestContext({ plannedRoute: route, selectedPoiId: 'arc', view: 'map', messages: [{ role: 'user', content: '把顺序反过来' }] });
  assert.ok(JSON.stringify(route).length > 65536);
  assert.ok(JSON.stringify(context).length < 1000);
  assert.deepEqual(context.plannedRoute.stops, [{ poiId: 'eiffel' }, { poiId: 'arc' }, { poiId: 'colosseum' }]);
  assert.deepEqual(guidePayload({ text: '把顺序反过来', context }).pageContext.route.stops.map(s => s.id), ['eiffel', 'arc', 'colosseum']);
});

test('text model -> backend tool -> API traces -> controller displays the model-planned route', async t => {
  let round = 0;
  const app = createApp({ env: { CHAT_API_KEY: 'test-key' }, agent: input => runAgent({ ...input, complete: async (_provider, body) => {
    const toolCall = (id, name, args) => ({ choices: [{ message: { tool_calls: [{ id, function: { name, arguments: JSON.stringify(args) } }] } }] });
    if (round++ === 0) {
      assert.match(body.messages[0].content, /plan_route/);
      return toolCall('knowledge', 'search_knowledge_base', { query: '欧洲区 埃菲尔铁塔 凯旋门 罗马斗兽场 路线' });
    }
    if (round === 2) { assert.ok(JSON.parse(body.messages.at(-1).content).results.length); return toolCall('route', 'plan_route', args); }
    const modelRoute = JSON.parse(body.messages.at(-1).content).route;
    assert.deepEqual(modelRoute.stops.map(stop => stop.poiId), ['eiffel', 'arc', 'colosseum']);
    assert.equal(modelRoute.geometry.points, undefined); assert.equal(modelRoute.geometry.legs.length, 2);
    return { choices: [{ message: { content: '建议按铁塔、凯旋门、斗兽场的顺序游览，路线仅供参考。' } }] };
  } }) });
  t.after(() => app.close());
  const resolver = createGuideResolver({ request: async (text, context) => {
    const response = await app.inject({ method: 'POST', url: '/api/guide', payload: { text, context } });
    assert.equal(response.statusCode, 200); return response.json();
  } });
  const store = createStore({ view: 'panorama', interactionInput: 'text' });
  const guide = controller(store, { resolveIntent: resolver });
  t.after(() => guide.dispose());
  await guide.submit('请规划铁塔、凯旋门、斗兽场的游览路线');
  assert.equal(store.get().view, 'map');
  assert.deepEqual(store.get().plannedRoute.stops.map(stop => stop.poiId), ['eiffel', 'arc', 'colosseum']);
  assert.equal(store.get().guideTraces.length, 2);
  assert.ok(store.get().plannedRoute.geometry.points.length > 3);
  const catalog = (await app.inject('/api/tools')).json();
  assert.ok(catalog.some(tool => tool.name === 'plan_route'));
  assert.ok(!catalog.some(tool => tool.name === 'get_weather'));
});

test('route uses artwork points directly, reaches anchors in order and shares the hand-traced overlay', () => {
  const route = toolEffect(routeTrace()).plannedRoute;
  const { points, stopIndices } = routeDisplayGeometry(route);
  assert.deepEqual(points, route.geometry.points, 'artwork coordinates must never be geographically projected again');
  for (const [i, stop] of route.stops.entries()) {
    const expected = stop.roadAnchor.position, actual = points[stopIndices[i]];
    assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-8);
  }
  assert.equal((routePath(route).match(/[ML]/g) ?? []).length, points.length);
  const nodes = new Map(artworkRoads.nodes.map(node => [node.id, node]));
  for (const [i, p] of points.entries()) assert.deepEqual(p, { x: nodes.get(route.geometry.nodeIds[i]).x, y: nodes.get(route.geometry.nodeIds[i]).y });
});

test('native voice displays tool_end before the final answer, deduplicates replay and ignores stale tools', async () => {
  const trace = routeTrace(); let events, finish;
  const store = createStore({ view: 'panorama' });
  const guide = controller(store, { speech: { stop() {}, respondToAudio: (_audio, _context, options) => {
    events = options; return new Promise(resolve => { finish = resolve; });
  } } });
  const pending = guide.submitAudio('audio');
  events.onToolEnd(trace);
  assert.equal(store.get().view, 'map'); assert.ok(store.get().plannedRoute);
  guide.clearRoute();
  events.onToolEnd(trace);
  events.onAnswer({ content: '路线规划完成。', traces: [trace] });
  assert.equal(store.get().plannedRoute, null, 'clearing a route must survive a duplicate final trace');
  guide.interrupt();
  events.onToolEnd(routeTrace('late'));
  assert.equal(store.get().plannedRoute, null);
  finish({ status: 'success' });
  assert.equal((await pending).status, 'cancelled'); guide.dispose();
});

test('failed text planning and interrupted requests never overwrite the existing route', async () => {
  const original = toolEffect(routeTrace()).plannedRoute;
  let resolve;
  const store = createStore({ plannedRoute: original, interactionInput: 'text' });
  const guide = controller(store, { resolveIntent: async () => ({ type: 'answer', text: '规划失败', traces: [{ ...routeTrace(), status: 'error' }] }) });
  await guide.submit('换一条路线'); assert.equal(store.get().plannedRoute, original); guide.dispose();
  const next = controller(store, { resolveIntent: () => new Promise(done => { resolve = done; }) });
  const pending = next.submit('规划新路线'); next.interrupt();
  resolve({ type: 'answer', text: '过期结果', traces: [routeTrace()] });
  assert.equal((await pending).status, 'cancelled'); assert.equal(store.get().plannedRoute, original); next.dispose();
});

test('native voice service forwards backend tool completion events before the final answer', async () => {
  const received = [];
  const trace = routeTrace();
  const scope = { atob, setTimeout, clearTimeout, AudioContext: class { state = 'running'; async resume() {} async close() {} } };
  const voice = createNativeVoiceService({ scope, browserSpeech: { stopSpeaking() {}, stopRecognition() {} }, fetchImpl: async () => new Response([
    { type: 'tool_end', trace }, { type: 'answer', content: '路线建议', traces: [trace] },
  ].map(event => JSON.stringify(event)).join('\n'), { headers: { 'Content-Type': 'application/x-ndjson' } }) });
  const result = await voice.respondToAudio('audio', {}, { onToolEnd: event => received.push(event.name), onAnswer: () => received.push('answer') });
  assert.deepEqual(received, ['plan_route', 'answer']);
  assert.equal(result.error, 'missing-audio'); voice.dispose();
});
