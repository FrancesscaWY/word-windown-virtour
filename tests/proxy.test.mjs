import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createProxy } from '../server/proxy.ts';
import { readFile } from 'node:fs/promises';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_r, reject) => { timer = setTimeout(() => reject(new Error('Proxy event timeout')), 3000); })]); }
  finally { clearTimeout(timer); }
}
async function fixture(t, options = {}) {
  const result = await createProxy({ backendOptions: { env: {} }, ...options });
  t.after(() => result.proxy.close());
  await result.proxy.listen({ host: '127.0.0.1', port: 0 });
  return { ...result, base: `http://127.0.0.1:${result.proxy.server.address().port}` };
}
const post = (base, path, payload, extra = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), ...extra });
const audio = Buffer.alloc(6400).toString('base64');

test('one proxy port serves frontend and API; internal backend is loopback-only and API-only', async t => {
  const { proxy, backend, base } = await fixture(t);
  assert.equal(backend.server.address().address, '127.0.0.1');
  assert.notEqual(backend.server.address().port, proxy.server.address().port);
  for (const path of ['/', '/modes.html', '/tour.html', '/src/tour-entry.js', '/assets/demo-panorama.png']) {
    const response = await fetch(base + path); assert.equal(response.status, 200, path); await response.arrayBuffer();
  }
  assert.equal((await (await fetch(base + '/api/health?probe=same-origin')).json()).ok, true);
  const response = await post(base, '/api/guide', { text: '世界之窗怎么坐地铁去' }, { headers: { 'Content-Type': 'application/json', Origin: base } });
  assert.equal(response.status, 503); assert.equal((await response.json()).error, 'GUIDE_NOT_CONFIGURED');
  assert.equal((await backend.inject('/')).statusCode, 404);
  for (const path of ['/.env', '/server/proxy.ts', '/node_modules/fastify/package.json', '/api/config']) {
    const response = await fetch(base + path); assert.equal(response.status, 404, path); await response.arrayBuffer();
  }
});

test('proxy preserves validation, body limits, missing configuration and cross-site rejection', async t => {
  const { base } = await fixture(t);
  const requests = [
    [() => post(base, '/api/guide', { text: '' }), 400],
    [() => post(base, '/api/guide', { text: 'hello', extra: 'x'.repeat(65536) }), 413],
    [() => post(base, '/api/voice', { audio }), 503],
    [() => fetch(base + '/api/guide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }), 400],
    [() => post(base, '/api/guide', { text: 'hello' }, { headers: { 'Content-Type': 'text/plain' } }), 415],
    [() => post(base, '/api/guide', { text: 'hello' }, { headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example', 'X-Forwarded-Host': 'evil.example' } }), 403],
    [() => fetch(base + '/api/guide'), 405],
    [() => fetch(base + '/api/missing'), 404],
  ];
  for (const [request, expected] of requests) {
    const response = await request(); assert.equal(response.status, expected); await response.arrayBuffer();
  }
});

test('explicit public Origin works behind a port-stripping tunnel without trusting forwarded-host', async t => {
  const publicOrigin = 'https://tour.example.com:55555';
  const { proxy } = await fixture(t, { backendOptions: { env: { PUBLIC_ORIGINS: publicOrigin } } });
  const call = (origin, extra = {}) => proxy.inject({ method: 'POST', url: '/api/guide', headers: {
    host: 'tour.example.com', origin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...extra,
  }, payload: { text: '你好' } });
  const allowed = await call(publicOrigin);
  assert.equal(allowed.statusCode, 503); // Reaches the API's missing-key guard, not the Origin 403.
  assert.equal(allowed.json().error, 'GUIDE_NOT_CONFIGURED');
  for (const origin of ['https://tour.example.com:55556', 'http://tour.example.com:55555', 'https://evil.example', 'null', 'https://tour.example.com:55555/path']) {
    assert.equal((await call(origin, { 'x-forwarded-host': 'tour.example.com:55555' })).statusCode, 403, origin);
  }
  assert.equal((await call(publicOrigin, { 'sec-fetch-site': 'cross-site' })).statusCode, 403);
});

test('proxy passes voice uploads over 1MiB and returns each NDJSON chunk before the answer completes', async t => {
  const finish = deferred(), started = deferred();
  const largeAudio = Buffer.alloc(1200000).toString('base64');
  const { base } = await fixture(t, { backendOptions: { env: { DASHSCOPE_API_KEY: 'test' }, voiceAgent: async options => {
    assert.equal(options.audio, largeAudio);
    options.onEvent({ type: 'audio_delta', audio, sampleRate: 24000 }); started.resolve();
    await finish.promise;
    return { content: '流式完成', traces: [] };
  } } });
  t.after(() => finish.resolve());
  const response = await post(base, '/api/voice', { audio: largeAudio });
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /ndjson/);
  assert.equal(response.headers.get('x-accel-buffering'), 'no');
  const reader = response.body.getReader(); let raw = '';
  try {
    await bounded(started.promise);
    while (!raw.includes('audio_delta')) raw += new TextDecoder().decode((await bounded(reader.read())).value);
    assert.doesNotMatch(raw, /"type":"answer"/);
    finish.resolve();
    while (true) { const next = await bounded(reader.read()); if (next.done) break; raw += new TextDecoder().decode(next.value); }
    assert.equal(JSON.parse(raw.trim().split('\n').at(-1)).content, '流式完成');
  } finally { finish.resolve(); await reader.cancel().catch(() => {}); }
});

test('client cancellation before text response headers reaches model immediately and never retries', async t => {
  const started = deferred(), cancelled = deferred(); let calls = 0;
  const { base } = await fixture(t, { backendOptions: { env: { DEEPSEEK_API_KEY: 'test' }, agent: options => new Promise((_r, reject) => {
    calls++; started.resolve();
    options.signal.addEventListener('abort', () => { cancelled.resolve(); reject(new Error('cancelled')); }, { once: true });
  }) } });
  const controller = new AbortController();
  const pending = post(base, '/api/guide', { text: '等待回答' }, { signal: controller.signal }).catch(error => error);
  try { await bounded(started.promise); controller.abort(); await pending; await bounded(cancelled.promise); assert.equal(calls, 1); }
  finally { controller.abort(); }
});

test('cancelling a voice stream and stopping the proxy both abort the internal model and release the port', async t => {
  const cancelled = deferred();
  const { proxy, backend, base } = await fixture(t, { backendOptions: { env: { DASHSCOPE_API_KEY: 'test' }, voiceAgent: options => new Promise((_r, reject) => {
    options.signal.addEventListener('abort', () => { cancelled.resolve(); reject(new Error('cancelled')); }, { once: true });
  }) } });
  const port = backend.server.address().port;
  const response = await post(base, '/api/voice', { audio });
  await response.body.cancel(); await bounded(cancelled.promise);
  const another = await post(base, '/api/voice', { audio });
  await bounded(proxy.close());
  await another.body.cancel().catch(() => {});
  assert.equal(backend.server.listening, false);
  const probe = createServer(); probe.listen(port, '127.0.0.1'); await once(probe, 'listening'); await new Promise(resolve => probe.close(resolve));
});

test('proxy can serve an explicit production dist tree independently of source pages', async t => {
  await mkdir('agent-tmp', { recursive: true });
  const root = await mkdtemp(join(process.cwd(), 'agent-tmp/proxy-dist-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'dist/index.html'), '<title>Built production page</title>');
  const { base } = await fixture(t, { root, dist: true });
  assert.match(await (await fetch(base + '/')).text(), /Built production page/);
  assert.equal((await (await fetch(base + '/api/health')).json()).ok, true);
});

test('dev, start and preview all use the proxy entry rather than running a standalone API listener', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const source = await readFile(new URL('../server/index.ts', import.meta.url), 'utf8');
  for (const name of ['dev', 'start', 'dev:lan', 'preview']) assert.match(pkg.scripts[name], /server\/index\.ts/);
  assert.match(source, /createProxy/); assert.doesNotMatch(source, /createApp/);
});
