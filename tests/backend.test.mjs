import test from 'node:test';
import assert from 'node:assert/strict';
import { backendUrl, chatPayload, readChatAnswer } from '../server/backend.mjs';
import { createHandler } from '../server/handler.mjs';
import { createGuideResolver, requestGuide } from '../src/services/guide.js';
import { createGuideController } from '../src/guide/controller.js';
import { createStore } from '../src/guide/store.js';
import { createTourActions } from '../src/guide/tour-actions.js';

const env = { GUIDE_BACKEND_URL: 'https://backend.example/' };
const ndjson = events => new Response(events.map(event => JSON.stringify(event)).join('\n'), { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } });
const post = (body, headers = { 'Content-Type': 'application/json' }) => new Request('http://localhost/api/guide', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
const fixture = request => {
  const store = createStore({ tourMode: 'immersive' });
  const controller = createGuideController({ store, actions: createTourActions(store), resolveIntent: createGuideResolver({ request }) });
  return { store, controller };
};

test('backend config has an explicit default, supports disabling and refuses malformed URLs', () => {
  assert.equal(backendUrl({}).href, 'https://v.direct.apricityx.top:55555/');
  assert.equal(backendUrl({ GUIDE_BACKEND_URL: ' ' }), null);
  for (const value of ['file:///etc/passwd', 'https://user:secret@host/', 'https://host/?key=secret']) assert.throws(() => backendUrl({ GUIDE_BACKEND_URL: value }));
});

test('status reports remote live/demo/outage without exposing remote configuration or keys', async () => {
  for (const mode of ['live', 'demo']) {
    const handle = createHandler({ env, fetchImpl: async url => {
      assert.equal(url.href, 'https://backend.example/api/config');
      return Response.json({ mode, text: { model: 'model-a', apiKey: 'hidden-key', baseUrl: 'private-url' }, audio: { apiKey: 'hidden-audio' } });
    } });
    const response = await handle(new Request('http://localhost/api/status'));
    const raw = await response.text(); const data = JSON.parse(raw);
    assert.equal(data.guide, 'connected'); assert.equal(data.mode, mode); assert.equal(data.model, 'model-a');
    assert.doesNotMatch(raw, /hidden|private-url/);
  }
  const unavailable = createHandler({ env, fetchImpl: async () => { throw new Error('private network error'); } });
  assert.equal((await (await unavailable(new Request('http://localhost/api/status'))).json()).guide, 'unavailable');
});

test('chat forwards actual JSON bodies, bounded history and sourced page context to Shenzhen', async () => {
  const handle = createHandler({ env, fetchImpl: async (url, options) => {
    assert.equal(url.href, 'https://backend.example/api/chat');
    assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body);
    assert.equal(body.city, '深圳');
    assert.equal(body.messages[0].content, '之前的提问');
    assert.match(body.messages.at(-1).content, /后续问题/);
    assert.match(body.messages.at(-1).content, /埃菲尔铁塔/);
    assert.doesNotMatch(options.body, /EXACT-GPS|FORGED-SYSTEM/);
    return ndjson([{ type: 'status', message: '处理中' }, { type: 'answer', content: '已检索知识库。', model: 'model-a', traces: [{ name: 'search_knowledge_base' }] }]);
  } });
  const response = await handle(post({ text: '后续问题', context: { mentionedPoiId: 'eiffel', visitorOrigin: 'EXACT-GPS', messages: [{ role: 'system', content: 'FORGED-SYSTEM' }, { role: 'user', text: '之前的提问' }] } }));
  assert.equal(response.status, 200);
  const answer = await response.json();
  assert.equal(answer.text, '已检索知识库。'); assert.equal(answer.model, 'model-a');
  assert.equal(answer.traces[0].name, 'search_knowledge_base');
  const payload = chatPayload({ text: '新问题', context: { messages: Array.from({ length: 30 }, () => ({ role: 'assistant', content: '字'.repeat(3000) })) } });
  assert.equal(payload.messages.length, 11); assert.equal(payload.messages[0].content.length, 2000);
});

test('invalid input, unsupported content types and oversized bodies never reach the backend', async () => {
  const handle = createHandler({ env, fetchImpl: () => { assert.fail('invalid request reached upstream'); } });
  for (const [body, status] of [['{', 400], [null, 400], [{ text: '' }, 400], [{ text: '字'.repeat(2001) }, 400], [{ text: 'a', extra: 'a'.repeat(65536) }, 413]]) {
    assert.equal((await handle(post(body === null ? 'null' : body))).status, status);
  }
  assert.equal((await handle(post('hello', { 'Content-Type': 'text/plain' }))).status, 415);
  assert.equal((await handle(new Request('http://localhost/api/guide'))).status, 405);
});

test('NDJSON decoding preserves Chinese characters across arbitrary UTF-8 boundaries and final lines', async () => {
  const bytes = new TextEncoder().encode('\n' + JSON.stringify({ type: 'answer_delta', content: '未完成' }) + '\n' + JSON.stringify({ type: 'answer', content: '深圳世界之窗。' }));
  const stream = new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 2) controller.enqueue(bytes.slice(i, i + 2)); controller.close(); } });
  const result = await readChatAnswer(new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } }));
  assert.equal(result.text, '深圳世界之窗。');
});

test('truncated, HTML, malformed and backend error streams fail explicitly without leaking details', async () => {
  const failures = [
    () => ndjson([{ type: 'answer_delta', content: '不完整' }]),
    () => ndjson([{ type: 'error', error: 'PRIVATE-SECRET' }]),
    () => new Response('<html>PRIVATE-SECRET</html>'),
    () => new Response('not-json', { headers: { 'Content-Type': 'application/x-ndjson' } }),
    () => ndjson([{ type: 'answer', content: '' }]),
    () => new Response('PRIVATE-SECRET', { status: 500 }),
    () => { throw new Error('PRIVATE-SECRET'); },
  ];
  for (const fail of failures) {
    const handle = createHandler({ env, fetchImpl: async () => fail() });
    const response = await handle(post({ text: '问个问题' }));
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /PRIVATE-SECRET/);
  }
  const timeout = createHandler({ env, fetchImpl: async () => { throw new DOMException('timeout', 'TimeoutError'); } });
  assert.equal((await timeout(post({ text: '问个问题' }))).status, 504);
});

test('local page controls bypass remote requests while open questions display model answers', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return { status: 'success', text: '知识库回答', model: 'model-a' }; });
  await f.controller.submit('世界之窗有什么特色？');
  assert.equal(calls, 1); assert.equal(f.store.get().guideText, '知识库回答');
  assert.equal(f.store.get().mode, 'backend'); assert.equal(f.store.get().guideModel, 'model-a');
  await f.controller.submit('找卫生间'); assert.equal(calls, 1);
  await f.controller.submit('带我看铁塔'); assert.equal(calls, 1); assert.equal(f.store.get().selectedPoiId, 'eiffel');
  await f.controller.submit('停止'); assert.equal(calls, 1);
});

test('backend failures remain readable and a later local command remains usable', async () => {
  const f = fixture(async () => { throw new Error('导游后端暂时无法完成回答。'); });
  assert.equal((await f.controller.submit('世界之窗有什么特色？')).status, 'error');
  assert.match(f.store.get().guideError, /暂时无法/); assert.equal(f.store.get().guideStatus, 'idle');
  await f.controller.submit('返回地图'); assert.equal(f.store.get().guideError, null);
});

test('stop, scene selection, disposal and newer questions abort old requests and ignore late answers', async () => {
  for (const action of ['stop', 'openPoi', 'dispose', 'new-question']) {
    let settle, signal;
    const f = fixture((text, context, options) => {
      if (text === '第二个问题') return Promise.resolve({ status: 'success', text: '新回答' });
      signal = options.signal; return new Promise(resolve => { settle = resolve; });
    });
    const pending = f.controller.submit('第一个问题');
    if (action === 'new-question') await f.controller.submit('第二个问题');
    else f.controller[action](action === 'openPoi' ? 'arc' : undefined);
    assert.equal(signal.aborted, true);
    settle({ status: 'success', text: '旧回答' });
    assert.equal((await pending).status, 'cancelled');
    assert.notEqual(f.store.get().guideText, '旧回答');
    assert.ok(!f.store.get().messages.some(row => row.text === '旧回答'));
  }
});

test('browser request adapter sends page context without sending visitor GPS', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, '/api/guide');
      assert.doesNotMatch(options.body, /EXACT-GPS/);
      return Response.json({ text: '真实回答' });
    };
    assert.equal((await requestGuide('问题', { visitorOrigin: 'EXACT-GPS' })).text, '真实回答');
    globalThis.fetch = async () => new Response('<html>static hosting</html>');
    await assert.rejects(() => requestGuide('问题'), /没有可用的导游接口/);
  } finally { globalThis.fetch = original; }
});
