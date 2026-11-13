import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { request as httpRequest } from 'node:http';
import { spawnSync } from 'node:child_process';
import { createChatJournal } from '../server/chat-log.ts';
import { createApp } from '../server/app.ts';
import { runAgent } from '../server/ai/llm.ts';
import { createHandler } from '../server/handler.ts';
import { listChats, inspectChat } from '../scripts/inspect-chat.mjs';

async function temp(t) {
  await mkdir('agent-tmp', { recursive: true });
  const root = await mkdtemp(resolve('agent-tmp/chat-log-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('chat journals are ordered, private, redacted, idempotent and not statically served', async t => {
  const root = await temp(t), errors = [];
  const journal = createChatJournal({ root, requestId: 'request-1', model: 'test-model', secrets: ['private-key'], onError: () => errors.push(true) });
  journal.record({ type: 'request.input', messages: [{ role: 'user', content: '问题 private-key Bearer another-key' }],
    nested: { api_key: 'unknown-key', authorization: 'unknown-auth', 'x-api-key': 'other-key', password: 'unknown-password', access_token: 'token-value' }, reasoning_content: 'hidden-reasoning' });
  const result = { outcome: 'success', httpStatus: 200, answer: '回答 private-key' };
  const done = journal.close(result); assert.equal(journal.close(result), done); await done;
  journal.record({ type: 'late' });
  const [saved] = await listChats(root), report = await inspectChat(saved.directory, { events: true });
  assert.deepEqual(errors, []);
  assert.equal(report.chatId, journal.id); assert.equal(report.outcome, 'success');
  assert.equal(report.logging.complete, true); assert.equal(report.answer, '回答 [REDACTED]');
  assert.ok(report.events.every((row, i) => row.seq === i + 1 && row.chatId === journal.id && row.requestId === 'request-1'));
  assert.ok(report.events.every((row, i) => !i || row.elapsedMs >= report.events[i - 1].elapsedMs));
  assert.equal(report.events.at(-1).event.type, 'request.finished');
  const contents = JSON.stringify(report);
  assert.doesNotMatch(contents, /private-key|another-key|unknown-key|unknown-auth|other-key|unknown-password|token-value|hidden-reasoning/);
  for (const filename of ['events.jsonl', 'summary.json']) assert.equal((await stat(resolve(saved.directory, filename))).mode & 0o777, 0o600);
  assert.equal((await stat(saved.directory)).mode & 0o777, 0o700);
  for (const path of ['/logs/chats/test/events.jsonl', '/api/logs', '/api/chats']) {
    assert.equal((await createHandler()(new Request(`http://localhost${path}`))).status, 404);
  }
});

test('real agent orchestration logs prompts, model rounds, tools and normalized context without changing response JSON', async t => {
  const root = await temp(t);
  const app = createApp({ env: { CHAT_LOG_DIR: root, CHAT_API_KEY: 'private-text-key', DASHSCOPE_API_KEY: 'private-voice-key' },
    agent: input => {
      let round = 0;
      return runAgent({ ...input, complete: async () => round++ === 0
        ? { choices: [{ message: { reasoning_content: 'do-not-save-reasoning', tool_calls: [{ id: 'lookup', function: { name: 'search_knowledge_base', arguments: '{"query":"世界之窗 开园"}' } }] } }], usage: { total_tokens: 10 } }
        : { choices: [{ message: { content: '1994年6月18日开园。' } }], usage: { total_tokens: 20 } } });
    } });
  t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: '/api/guide', payload: { text: '何时开园？',
    context: { messages: [{ role: 'user', content: '深圳世界之窗' }], selectedPoiId: 'eiffel', view: 'map', apiKey: 'must-not-log-untrusted-context', arbitrary: 'not-forwarded' } } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(Object.keys(response.json()).sort(), ['status', 'text', 'traces', 'usage', 'model', 'mode'].sort());
  assert.equal(response.json().text, '1994年6月18日开园。');
  await app.close(); // Must flush pending log writes.
  const [saved] = await listChats(root), report = await inspectChat(saved.directory, { events: true });
  assert.equal(report.httpStatus, 200); assert.equal(report.outcome, 'success');
  assert.equal(report.answer, response.json().text); assert.equal(report.usage.total_tokens, 30);
  assert.equal(report.input.messages.at(-1).content, '何时开园？');
  assert.equal(report.input.pageContext.topic.name, '埃菲尔铁塔');
  assert.equal(report.modelRounds.length, 2); assert.equal(report.tools[0].name, 'search_knowledge_base');
  assert.ok(report.events.some(row => row.event.type === 'tool_start'));
  assert.ok(report.events.some(row => row.event.type === 'tool_end' && row.event.trace.result.results.length));
  assert.ok(report.events.find(row => row.event.type === 'model.request').event.messages[0].content.includes('你叫沐沐'));
  assert.doesNotMatch(JSON.stringify(report), /private-text-key|private-voice-key|do-not-save-reasoning|must-not-log-untrusted-context|not-forwarded/);
});

test('model failures and timeouts retain diagnostic details only on the server', async t => {
  for (const timeout of [false, true]) {
    const root = await temp(t);
    const app = createApp({ env: { CHAT_LOG_DIR: root, CHAT_API_KEY: 'private-key' }, guideTimeoutMs: 15,
      agent: input => runAgent({ ...input, complete: async () => {
        if (timeout) return new Promise(() => {});
        throw new Error('provider returned 401 private-key Bearer hidden-token');
      } }) });
    t.after(() => app.close());
    const response = await app.inject({ method: 'POST', url: '/api/guide', payload: { text: '问题' } });
    assert.equal(response.statusCode, timeout ? 504 : 502);
    assert.doesNotMatch(response.body, /provider returned|private-key|hidden-token/);
    await app.close();
    const [saved] = await listChats(root), report = await inspectChat(saved.directory, { events: true });
    assert.equal(report.outcome, timeout ? 'timeout' : 'error');
    assert.equal(report.httpStatus, response.statusCode); assert.equal(report.logging.complete, true);
    assert.ok(report.errors.some(row => row.event.type === 'request.error'));
    if (!timeout) assert.ok(report.errors.some(row => row.event.type === 'model.error' && row.event.error.message.includes('401')));
    assert.doesNotMatch(JSON.stringify(report), /private-key|hidden-token/);
  }
});

test('invalid, unconfigured and cross-origin requests have rejected summaries', async t => {
  const root = await temp(t), app = createApp({ env: { CHAT_LOG_DIR: root } });
  t.after(() => app.close());
  for (const [options, status] of [
    [{ payload: { text: '' } }, 400],
    [{ payload: '{', headers: { 'content-type': 'application/json' } }, 400],
    [{ payload: { text: '有效问题' } }, 503],
    [{ payload: { text: '跨站问题' }, headers: { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' } }, 403],
  ]) assert.equal((await app.inject({ method: 'POST', url: '/api/guide', ...options })).statusCode, status);
  await app.close();
  const chats = await listChats(root);
  assert.equal(chats.length, 4); assert.equal(new Set(chats.map(chat => chat.chatId)).size, 4);
  assert.ok(chats.every(chat => chat.outcome === 'rejected' && chat.logging.complete));
});

test('parallel turns remain isolated and busy rejections are journaled', async t => {
  const root = await temp(t), started = [], release = [];
  let ready;
  const allStarted = new Promise(resolve => { ready = resolve; });
  const app = createApp({ env: { CHAT_LOG_DIR: root, CHAT_API_KEY: 'test-key' }, agent: async input => {
    const question = input.messages.at(-1).content;
    started.push(question); if (started.length === 3) ready();
    await new Promise(resolve => release.push(resolve));
    return { content: `回答：${question}`, traces: [] };
  } });
  t.after(() => app.close());
  const responses = ['问题甲', '问题乙', '问题丙'].map(text => app.inject({ method: 'POST', url: '/api/guide', payload: { text } }).then(value => value));
  await allStarted;
  const busy = await app.inject({ method: 'POST', url: '/api/guide', payload: { text: '请求繁忙' } });
  assert.equal(busy.statusCode, 429); release.forEach(done => done());
  assert.ok((await Promise.all(responses)).every(response => response.statusCode === 200));
  await app.close();
  const chats = await listChats(root);
  assert.equal(chats.length, 4);
  for (const chat of chats.filter(chat => chat.outcome === 'success')) assert.equal(chat.answer, `回答：${chat.question}`);
  const rejected = chats.find(chat => chat.httpStatus === 429);
  assert.equal(rejected.outcome, 'rejected');
  assert.ok((await inspectChat(rejected.directory)).errors.some(row => row.event.code === 'BUSY'));
});

test('client disconnect cancels the turn, retains errors and flushes the cancellation journal', { timeout: 10000 }, async t => {
  const root = await temp(t);
  let entered, aborted;
  const started = new Promise(resolve => { entered = resolve; });
  const cancelled = new Promise(resolve => { aborted = resolve; });
  const app = createApp({ env: { CHAT_LOG_DIR: root, CHAT_API_KEY: 'test-key' }, agent: async ({ signal }) => {
    entered();
    await new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted(); reject(signal.reason); }, { once: true }));
    return { content: '不应显示', traces: [] };
  } });
  t.after(() => app.close());
  const origin = await app.listen({ port: 0, host: '127.0.0.1' });
  const request = httpRequest(`${origin}/api/guide`, { method: 'POST', headers: { 'content-type': 'application/json' } });
  request.on('error', () => {}); request.end(JSON.stringify({ text: '取消的请求' }));
  await started; request.destroy(); await cancelled;
  await app.close();
  const [saved] = await listChats(root), report = await inspectChat(saved.directory, { events: true });
  assert.equal(report.outcome, 'cancelled'); assert.equal(report.httpStatus, 499);
  assert.ok(report.errors.some(row => row.event.type === 'client.disconnected'));
  assert.ok(report.errors.some(row => row.event.type === 'request.error'));
});

test('oversized and unserializable diagnostic events cannot crash a journal or pretend completeness', async t => {
  const root = await temp(t), errors = [];
  const journal = createChatJournal({ root, model: 'test', requestId: 'r', onError: () => errors.push(true) });
  journal.record({ type: 'large', data: 'x'.repeat(2 * 1024 * 1024) });
  await journal.close({ outcome: 'success', httpStatus: 200 });
  const [saved] = await listChats(root), report = await inspectChat(saved.directory, { events: true });
  assert.equal(report.logging.complete, false); assert.equal(report.logging.truncatedEvents, 1);
  assert.ok(report.events.some(row => row.event.type === 'log.omitted'));
  const second = createChatJournal({ root, model: 'test', requestId: 'r2', onError: () => errors.push(true) });
  second.record({ type: 'unserializable', value: 1n });
  await second.close({ outcome: 'success', httpStatus: 200 });
  assert.equal(errors.length, 1);
  assert.equal((await listChats(root)).find(chat => chat.chatId === second.id).logging.complete, false);
});

test('unwritable log locations do not break chat responses and are reported in backend logs', async t => {
  const root = await temp(t), file = resolve(root, 'not-a-directory');
  await writeFile(file, 'fixture');
  const warnings = [];
  t.mock.method(console, 'error', (...args) => warnings.push(args.join(' ')));
  const app = createApp({ env: { CHAT_LOG_DIR: file, CHAT_API_KEY: 'test-key' }, agent: async () => ({ content: '仍可回答', traces: [] }) });
  t.after(() => app.close());
  assert.equal((await app.inject({ method: 'POST', url: '/api/guide', payload: { text: '问题' } })).json().text, '仍可回答');
  await app.close();
  assert.ok(warnings.some(message => message.includes('Chat journal could not be created')));
});

test('CLI lists/selects logs, handles empty roots and reports incomplete trailing JSONL', async t => {
  const root = await temp(t), env = { ...process.env, CHAT_LOG_DIR: root };
  const cli = args => spawnSync(process.execPath, ['scripts/inspect-chat.mjs', ...args], { env, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(cli(['--list']).stdout), []);
  assert.equal(cli([]).status, 1);
  const journal = createChatJournal({ root, requestId: 'r', model: 'test' });
  journal.record({ type: 'request.input', messages: [{ role: 'user', content: '检查命令' }] });
  await journal.close({ outcome: 'success', httpStatus: 200, question: '检查命令', answer: '回答' });
  const result = cli(['--id', journal.id, '--events']); assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout); assert.equal(report.chatId, journal.id); assert.ok(report.events.length);
  assert.equal(JSON.parse(cli(['--list', '--limit', '1']).stdout).length, 1);
  assert.equal(cli(['--id', '../outside']).status, 1); assert.equal(cli(['--limit', 'NaN']).status, 1);
  assert.equal(cli(['--limit']).status, 1); assert.equal(cli(['--unknown']).status, 1);
  const [saved] = await listChats(root);
  await appendFile(resolve(saved.directory, 'events.jsonl'), '{"partial":');
  assert.equal((await inspectChat(saved.directory)).unreadableLines, 1);
  await rm(resolve(saved.directory, 'summary.json'));
  assert.equal((await inspectChat(saved.directory)).outcome, 'ongoing-or-unfinalized');
});
