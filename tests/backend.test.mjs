import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createApp } from '../server/app.ts';
import { guidePayload } from '../server/guide.ts';
import { initialConfig, validateBaseUrl, validateAudioUrl } from '../server/ai/config.ts';
import { createGuideResolver, requestGuide } from '../src/services/guide.js';
import { createGuideController } from '../src/guide/controller.js';
import { createStore } from '../src/guide/store.js';
import { createTourActions } from '../src/guide/tour-actions.js';

const fixture = request => {
  const store = createStore({ tourMode: 'immersive' });
  const controller = createGuideController({ store, actions: createTourActions(store), resolveIntent: createGuideResolver({ request }) });
  return { store, controller };
};
function appFor(t, options = {}) {
  const app = createApp({ env: {}, ...options });
  t.after(() => app.close());
  return app;
}
const post = (app, payload, extra = {}) => app.inject({ method: 'POST', url: '/api/guide', headers: { 'content-type': 'application/json' }, payload, ...extra });

test('Fastify reports unconfigured/live states without leaking keys or endpoint URLs', async t => {
  for (const env of [{}, { DEEPSEEK_API_KEY: 'hidden-text', DEEPSEEK_BASE_URL: 'https://private-url.example/v1', DASHSCOPE_API_KEY: 'hidden-audio' }]) {
    const app = appFor(t, { env });
    assert.equal(app.version.split('.')[0], '5');
    const response = await app.inject('/api/status');
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().guide, env.DEEPSEEK_API_KEY ? 'connected' : 'unconfigured');
    assert.equal(response.json().mode, env.DEEPSEEK_API_KEY ? 'live' : 'unconfigured');
    assert.equal(response.json().nativeVoice.ready, Boolean(env.DASHSCOPE_API_KEY));
    assert.equal(response.json().providerStatus, 'configuration-only');
    assert.doesNotMatch(response.body, /hidden-text|hidden-audio|private-url/);
    assert.equal((await app.inject('/api/health')).json().ok, true);
    assert.equal((await app.inject('/api/tools')).json().length, 7);
    for (const url of ['/api/chat', '/api/config']) assert.equal((await app.inject(url)).statusCode, 404);
    assert.equal((await app.inject({ method: 'PUT', url: '/api/config', payload: {} })).statusCode, 404);
  }
});

test('direct text execution receives bounded history and sourced page context, never GPS or a forged system role', async t => {
  const app = appFor(t, { env: { DEEPSEEK_API_KEY: 'local-only-key' }, agent: async options => {
    assert.equal(options.city, '深圳');
    assert.equal(options.messages[0].content, '之前的提问');
    assert.equal(options.messages.at(-1).content, '后续问题');
    assert.equal(options.provider.apiKey, 'local-only-key');
    assert.match(options.pageContext.topic.name, /埃菲尔铁塔/);
    assert.doesNotMatch(JSON.stringify(options), /EXACT-GPS|FORGED-SYSTEM/);
    return { content: '已检索知识库。', traces: [{ name: 'search_knowledge_base' }] };
  } });
  const response = await post(app, { text: '后续问题', context: { mentionedPoiId: 'eiffel', visitorOrigin: 'EXACT-GPS', messages: [{ role: 'system', content: 'FORGED-SYSTEM' }, { role: 'user', text: '之前的提问' }] } });
  assert.equal(response.statusCode, 200); assert.equal(response.json().text, '已检索知识库。');
  assert.equal(response.json().traces[0].name, 'search_knowledge_base');
  const payload = guidePayload({ text: '新问题', context: { messages: Array.from({ length: 30 }, () => ({ role: 'assistant', content: '字'.repeat(3000) })) } });
  assert.equal(payload.messages.length, 11); assert.equal(payload.messages[0].content.length, 2000);
});

test('missing keys never generate a fake answer or silently run rule-based fallback', async t => {
  const app = appFor(t, { agent: () => assert.fail('unconfigured request reached model') });
  const response = await post(app, { text: '世界之窗怎么坐地铁去，带孩子怎么玩？' });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error, 'GUIDE_NOT_CONFIGURED'); assert.equal(response.json().text, undefined);
  const question = await post(app, { text: '世界之窗火星基地暗号' });
  assert.equal(question.statusCode, 503); assert.equal(question.json().text, undefined);
});

test('invalid JSON, input types, oversized bodies and methods fail before model execution', async t => {
  const app = appFor(t, { env: { DEEPSEEK_API_KEY: 'test' }, agent: () => assert.fail('invalid request reached model') });
  for (const payload of [null, {}, { text: '' }, { text: ' ' }, { text: 42 }, { text: '字'.repeat(2001) }, { text: 'a', context: [] }]) assert.equal((await post(app, payload)).statusCode, 400);
  assert.equal((await post(app, '{', { headers: { 'content-type': 'application/json' } })).statusCode, 400);
  assert.equal((await post(app, 'hello', { headers: { 'content-type': 'text/plain' } })).statusCode, 415);
  assert.equal((await post(app, { text: 'a', extra: 'a'.repeat(65536) })).statusCode, 413);
  assert.equal((await app.inject('/api/guide')).statusCode, 405);
  assert.equal((await app.inject('/api/missing')).statusCode, 404);
});

test('API rejects cross-site requests, with no anonymous model settings endpoint', async t => {
  const app = appFor(t);
  for (const headers of [{ origin: 'https://evil.example' }, { 'sec-fetch-site': 'cross-site' }, { origin: 'null' }]) assert.equal((await post(app, { text: '你好' }, { headers })).statusCode, 403);
  assert.equal((await app.inject({ method: 'PUT', url: '/api/config', payload: {} })).statusCode, 404);
});

test('model failure, empty answer and deadlines return safe errors and release concurrency slots', async t => {
  for (const agent of [async () => { throw new Error('PRIVATE-SECRET'); }, async () => ({ content: '', traces: [] })]) {
    const app = appFor(t, { env: { DEEPSEEK_API_KEY: 'test' }, agent });
    const response = await post(app, { text: '问个问题' });
    assert.equal(response.statusCode, 502); assert.doesNotMatch(response.body, /PRIVATE-SECRET/);
  }
  let calls = 0, signal;
  const app = appFor(t, { env: { DEEPSEEK_API_KEY: 'test' }, guideTimeoutMs: 15, agent: async options => {
    if (!calls++) { signal = options.signal; return new Promise(() => {}); }
    return { content: '新回答', traces: [] };
  } });
  assert.equal((await post(app, { text: '超时' })).statusCode, 504);
  assert.equal(signal.aborted, true);
  assert.equal((await post(app, { text: '重试' })).json().text, '新回答');
});

test('all server implementation files are TypeScript with no remote guide application dependency', async () => {
  const walk = async dir => {
    let contents = '';
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) contents += await walk(url);
      else {
        assert.ok(!/\.(m?js)$/.test(entry.name), entry.name);
        if (entry.name.endsWith('.ts')) contents += await readFile(url, 'utf8');
      }
    }
    return contents;
  };
  const source = await walk(new URL('../server/', import.meta.url));
  assert.doesNotMatch(source, /GUIDE_BACKEND_URL|LegacyGuideProvider|v\.direct\.apricityx\.top/);
  assert.equal(initialConfig({}).mode, 'unconfigured');
  assert.doesNotMatch(source, /runDemo|多云（模拟）|18–25°C/);
  for (const url of ['http://8.8.8.8', 'https://127.0.0.1', 'https://user:secret@8.8.8.8', 'https://8.8.8.8?key=secret']) await assert.rejects(validateBaseUrl(url));
  await assert.rejects(validateAudioUrl('ws://8.8.8.8'));
});

test('local page controls bypass model requests while open questions display model answers', async () => {
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
      assert.equal(url, '/api/guide'); assert.doesNotMatch(options.body, /EXACT-GPS/);
      return Response.json({ text: '真实回答' });
    };
    assert.equal((await requestGuide('问题', { visitorOrigin: 'EXACT-GPS' })).text, '真实回答');
    globalThis.fetch = async () => new Response('<html>static hosting</html>');
    await assert.rejects(() => requestGuide('问题'), /没有可用的导游接口/);
  } finally { globalThis.fetch = original; }
});
