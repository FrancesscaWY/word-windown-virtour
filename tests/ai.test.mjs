import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { initialConfig, isPrivateAddress, validateBaseUrl, validateAudioUrl } from '../server/ai/config.ts';
import { tools, executeTool } from '../server/ai/tools.ts';
import { searchKnowledge } from '../server/ai/knowledge.ts';
import { completion, runAgent } from '../server/ai/llm.ts';
import { runVoice } from '../server/ai/voice.ts';

test('seven production tools preserve schemas and never return sample prices or simulated weather', () => {
  const required = { search_attractions: [], get_attraction_details: ['attraction'], get_weather: ['city'], plan_itinerary: ['city', 'days'], estimate_budget: ['attractions', 'people'], get_attraction_story: ['attraction'], search_knowledge_base: ['query'] };
  assert.equal(tools.length, 7);
  for (const tool of tools) {
    assert.deepEqual(tool.function.parameters.required, required[tool.function.name]);
    assert.equal(tool.function.parameters.additionalProperties, false);
  }
  assert.ok(executeTool('search_attractions', {}).attractions.length > 0);
  for (const [name, args] of [['eval', {}], ['search_attractions', null], ['search_attractions', { injected: true }], ['plan_itinerary', { city: '杭州', days: 8 }], ['estimate_budget', { attractions: ['西湖'], people: -1 }], ['search_knowledge_base', { query: ' ' }]]) assert.ok(executeTool(name, args).error);
  assert.equal(executeTool('estimate_budget', { attractions: ['西湖', '灵隐寺'], people: 2 }).total, null);
  const weather = executeTool('get_weather', { city: '深圳' });
  assert.equal(weather.status, 'unavailable');
  assert.equal(weather.temperature, undefined); assert.equal(weather.condition, undefined);
  assert.equal(executeTool('search_attractions', { city: '杭州' }).attractions.length, 0);
  assert.equal(executeTool('search_attractions', { max_price: 0 }).status, 'unavailable');
});

test('document knowledge preserves provenance, citations, temporal limitations and empty retrieval', () => {
  const result = searchKnowledge({ query: '世界之窗地铁怎么去', limit: 1 });
  assert.equal(result.retrieval, 'local-keyword');
  assert.equal(result.results[0].citation, 'WOW:transport');
  assert.equal(result.snapshot_date, '2026-11-12');
  assert.equal(result.results[0].sources[0].accessed_at, null);
  assert.match(result.results[0].sources[0].verification, /用户提供|未独立核验/);
  assert.equal(result.results[0].current_status, 'not_verified');
  for (const query of ['门票多少钱', '几点开放', '烟花演出']) assert.equal(searchKnowledge({ query, limit: 1 }).results[0].kind, 'dynamic');
  assert.equal(searchKnowledge({ query: '亲子带娃', limit: 1 }).results[0].kind, 'editorial');
  assert.equal(searchKnowledge({ query: '世界之窗火星基地暗号' }).status, 'not_found');
  assert.equal(executeTool('estimate_budget', { attractions: ['世界之窗'], people: 2 }).total, null);
});

test('production catalog tools use sourced park records with no invented operational fields', () => {
  const found = executeTool('search_attractions', { keyword: '铁塔' });
  assert.ok(found.attractions.some(a => a.id === 'eiffel' && a.source.startsWith('https://')));
  const details = executeTool('get_attraction_details', { attraction: '铁塔' });
  assert.equal(details.attraction.id, 'eiffel');
  assert.equal(details.ticket_price, null); assert.equal(details.opening_hours, null);
  const story = executeTool('get_attraction_story', { attraction: '不存在的景点' });
  assert.equal(story.status, 'not_found'); assert.equal(story.story, null);
  const plan = executeTool('plan_itinerary', { city: '深圳', days: 1 });
  assert.equal(plan.route, null); assert.equal(plan.ticket_total, null);
  assert.ok(plan.results.some(entry => entry.citation === 'WOW:route-r01'));
  assert.equal(executeTool('plan_itinerary', { city: '杭州', days: 1 }).status, 'unavailable');
});

test('model completions call the supplier directly with path, port, auth and redirect protection', async () => {
  for (const baseUrl of ['https://8.8.8.8:8443/v1', 'https://8.8.8.8:8443/compatible-mode/v1/']) {
    const result = await completion({ baseUrl, model: 'test-model', apiKey: 'private-key' }, { messages: [{ role: 'user', content: '你好' }], tools }, {
      fetchImpl: async (url, options) => {
        assert.equal(url, baseUrl.replace(/\/$/, '') + '/chat/completions');
        assert.equal(options.headers.Authorization, 'Bearer private-key'); assert.equal(options.redirect, 'error');
        assert.equal(JSON.parse(options.body).tools.length, 7);
        return Response.json({ choices: [{ message: { content: '你好！' } }] });
      },
    });
    assert.equal(result.choices[0].message.content, '你好！');
  }
  await assert.rejects(completion({ baseUrl: 'https://8.8.8.8', model: 'test', apiKey: 'key' }, { messages: [] }, { fetchImpl: async () => new Response('PRIVATE', { status: 401 }) }), error => !error.message.includes('PRIVATE') && error.message.includes('401'));
});

test('text model executes local tools, preserves reasoning only upstream and returns sourced answers', async () => {
  const requests = [];
  const result = await runAgent({ provider: {}, city: '深圳', pageContext: { park: '深圳世界之窗', view: '园区地图', topic: null }, messages: [{ role: 'user', content: '世界之窗怎么坐地铁去' }], complete: async (_provider, body) => {
    requests.push(structuredClone(body));
    if (requests.length === 1) return { choices: [{ message: { content: null, reasoning_content: 'PRIVATE-REASONING', tool_calls: [{ id: 'kb', function: { name: 'search_knowledge_base', arguments: '{"query":"世界之窗地铁","limit":1}' } }] } }], usage: { total_tokens: 10 } };
    const evidence = JSON.parse(body.messages.at(-1).content);
    assert.equal(evidence.results[0].citation, 'WOW:transport');
    assert.equal(body.messages.at(-2).reasoning_content, 'PRIVATE-REASONING');
    return { choices: [{ message: { content: '来源待复核的资料列出世界之窗站。[WOW:transport]' } }], usage: { total_tokens: 5 } };
  } });
  assert.match(requests[0].messages[0].content, /页面上下文/);
  assert.equal(result.usage.total_tokens, 15); assert.equal(result.traces[0].status, 'done');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-REASONING/);
});

test('text tool errors are fed back and tool loops remain bounded', async () => {
  let calls = 0;
  const result = await runAgent({ provider: {}, messages: [], city: '深圳', complete: async (_provider, body) => {
    if (!calls++) return { choices: [{ message: { tool_calls: [{ id: 'bad', function: { name: 'get_weather', arguments: '{broken' } }] } }] };
    assert.match(body.messages.at(-1).content, /不是合法 JSON/);
    return { choices: [{ message: { content: '请再说一次。' } }] };
  } });
  assert.equal(result.traces[0].status, 'error');
  calls = 0;
  await assert.rejects(runAgent({ provider: {}, messages: [], city: '深圳', complete: async () => ({ choices: [{ message: { tool_calls: [{ id: String(calls++), function: { name: 'get_weather', arguments: '{"city":"深圳"}' } }] } }] }) }), /超出/);
  assert.equal(calls, 6);
});

test('model endpoint restrictions reject private networks, credentials, queries and non-TLS URLs', async () => {
  for (const address of ['127.0.0.1', '169.254.169.254', '192.168.1.1', '::1', '::ffff:127.0.0.1', 'fc00::1']) assert.equal(isPrivateAddress(address), true);
  for (const url of ['http://8.8.8.8', 'https://127.0.0.1', 'https://user:pass@8.8.8.8', 'https://8.8.8.8?key=secret']) await assert.rejects(validateBaseUrl(url));
  assert.equal((await validateAudioUrl('wss://8.8.8.8:9443/realtime')).port, '9443');
});

class FakeSocket extends EventEmitter {
  sent = [];
  terminated = false;
  send(raw) { this.sent.push(JSON.parse(raw)); }
  terminate() { this.terminated = true; }
  event(type, data = {}) { this.emit('message', Buffer.from(JSON.stringify({ type, ...data }))); }
}
async function voiceFixture(extra = {}) {
  const socket = new FakeSocket(), events = [];
  const promise = runVoice({ provider: initialConfig({ DASHSCOPE_API_KEY: 'private-native-key' }).audio, audio: Buffer.alloc(6400).toString('base64'), city: '深圳', messages: [{ role: 'assistant', content: '你好' }], onEvent: e => events.push(e),
    validateUrl: async value => new URL(value), connect: (url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer private-native-key'); assert.equal(options.followRedirects, false);
      return socket;
    }, ...extra });
  await Promise.resolve();
  return { socket, events, promise };
}
function start(socket) {
  for (const type of ['session.created', 'session.updated', 'input_audio_buffer.committed']) socket.event(type);
  socket.event('response.created', { response: { id: 'response-1' } });
}
const done = socket => socket.event('response.done', { response: { status: 'completed' } });
const call = (socket, id, name, args) => socket.event('response.function_call_arguments.done', { call_id: id, name, arguments: args });

test('native Qwen PCM/tool/knowledge/audio protocol runs entirely in the migrated backend', async () => {
  const { socket, events, promise } = await voiceFixture(); start(socket);
  assert.equal(socket.sent[0].session.tools.length, 7);
  assert.equal(socket.sent[0].session.turn_detection, null);
  assert.match(socket.sent[0].session.instructions, /必须在本轮重新调用对应工具/);
  assert.equal(socket.sent.filter(e => e.type === 'input_audio_buffer.append').length, 2);
  socket.event('conversation.item.input_audio_transcription.completed', { transcript: '世界之窗怎么坐地铁去' });
  call(socket, 'knowledge', 'search_knowledge_base', '{"query":"世界之窗地铁","limit":1}'); done(socket);
  assert.equal(JSON.parse(socket.sent.find(e => e.item?.type === 'function_call_output').item.output).results[0].citation, 'WOW:transport');
  socket.event('response.created', { response: { id: 'response-2' } });
  socket.event('response.audio_transcript.done', { transcript: '资料待复核。' });
  socket.event('response.audio.delta', { delta: Buffer.alloc(4800).toString('base64') }); done(socket);
  const result = await promise;
  assert.equal(result.content, '资料待复核。'); assert.equal(result.traces[0].name, 'search_knowledge_base');
  assert.equal(events.filter(e => e.type === 'audio_delta').length, 1);
  assert.ok(socket.terminated); assert.doesNotMatch(JSON.stringify(events), /private-native-key/);
});

test('native voice uses imported document evidence and preserves source/date restrictions', async () => {
  const { socket, promise } = await voiceFixture(); start(socket);
  assert.match(socket.sent[0].session.instructions, /2026-11-12/);
  call(socket, 'doc-knowledge', 'search_knowledge_base', '{"query":"埃菲尔铁塔复制比例","limit":1}'); done(socket);
  const evidence = JSON.parse(socket.sent.find(e => e.item?.type === 'function_call_output').item.output);
  assert.equal(evidence.results[0].citation, 'WOW:eiffel-scale');
  assert.match(evidence.results[0].content, /1:3/);
  assert.match(evidence.disclaimer, /未独立核验/);
  socket.event('response.created', { response: { id: 'doc-response' } });
  socket.event('response.audio_transcript.done', { transcript: '用户文档记载园内铁塔按一比三仿建。' });
  socket.event('response.audio.delta', { delta: Buffer.alloc(4800).toString('base64') }); done(socket);
  const result = await promise;
  assert.equal(result.traces[0].result.results[0].id, 'eiffel-scale');
  assert.match(result.content, /用户文档/);
});

test('native voice suppresses duplicate tool calls and rejects bad arguments, excessive loops, errors and truncation', async () => {
  const one = await voiceFixture(); start(one.socket);
  call(one.socket, 'bad', 'get_weather', '{broken'); done(one.socket);
  call(one.socket, 'bad', 'get_weather', '{broken');
  one.socket.event('response.text.done', { text: '请再说一次。' }); done(one.socket);
  assert.equal((await one.promise).traces.length, 1);
  for (const type of ['calls', 'rounds', 'error', 'close', 'empty', 'invalid-audio', 'failed']) {
    const f = await voiceFixture(); start(f.socket);
    const rejection = assert.rejects(f.promise);
    if (type === 'calls') for (let i = 0; i < 9; i++) call(f.socket, String(i), 'get_weather', '{"city":"深圳"}');
    if (type === 'rounds') for (let i = 0; i < 6; i++) { call(f.socket, String(i), 'get_weather', '{"city":"深圳"}'); done(f.socket); }
    if (type === 'error') f.socket.event('error', { error: { message: 'private-native-key' } });
    if (type === 'close') f.socket.emit('close');
    if (type === 'empty') done(f.socket);
    if (type === 'invalid-audio') f.socket.event('response.audio.delta', { delta: 'invalid!' });
    if (type === 'failed') f.socket.event('response.done', { response: { status: 'failed' } });
    await rejection; assert.ok(f.socket.terminated);
  }
});

test('native voice cancellation and timeout release the supplier WebSocket', async () => {
  const controller = new AbortController();
  const f = await voiceFixture({ signal: controller.signal });
  const rejection = assert.rejects(f.promise, /取消/); controller.abort(); await rejection;
  assert.ok(f.socket.terminated);
  const timeout = await voiceFixture({ timeoutMs: 10 });
  await assert.rejects(timeout.promise, /超时/); assert.ok(timeout.socket.terminated);
});
