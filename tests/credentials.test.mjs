import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { initialConfig } from '../server/ai/config.ts';
import { createApp } from '../server/app.ts';

async function privateFile(t, content) {
  await mkdir('agent-tmp', { recursive: true });
  const dir = await mkdtemp(join(process.cwd(), 'agent-tmp/credentials-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, '.env');
  await writeFile(path, content, { mode: 0o600 });
  return path;
}

test('Chat configuration loads private env keys without copying them to public config', async t => {
  const path = await privateFile(t, 'CHAT_API_KEY="private-chat-fixture"\nDASHSCOPE_API_KEY="private-audio-fixture"\nHOST=untrusted\n');
  const env = { AI_CREDENTIALS_FILE: path, CHAT_BASE_URL: 'https://8.8.8.8/v1', CHAT_MODEL: 'chosen-model' };
  const config = initialConfig(env);
  assert.equal(config.mode, 'live');
  assert.equal(config.text.apiKey, 'private-chat-fixture');
  assert.equal(config.audio.apiKey, 'private-audio-fixture');
  assert.equal(config.text.baseUrl, env.CHAT_BASE_URL); assert.equal(config.text.model, 'chosen-model');
  assert.equal(initialConfig({ ...env, CHAT_API_KEY: 'process-key' }).text.apiKey, 'process-key');
  const app = createApp({ env }); t.after(() => app.close());
  const status = await app.inject('/api/status');
  assert.equal(status.json().mode, 'live'); assert.equal(status.json().nativeVoice.ready, true);
  for (const value of [path, 'private-chat-fixture', 'private-audio-fixture', env.CHAT_BASE_URL]) assert.ok(!status.body.includes(value));
});

test('unsafe credentials paths, permissions, symlinks and missing files fail closed', async t => {
  const path = await privateFile(t, 'CHAT_API_KEY="fixture"\n');
  const link = path + '-link'; await symlink(path, link);
  for (const file of ['./relative.env', path + '-missing', link]) assert.throws(() => initialConfig({ AI_CREDENTIALS_FILE: file }), /凭据文件/);
  await chmod(path, 0o644);
  assert.throws(() => initialConfig({ AI_CREDENTIALS_FILE: path }), /权限/);
});

test('missing or whitespace credentials cannot activate AI or a demo fallback', () => {
  assert.equal(initialConfig({}).mode, 'unconfigured');
  assert.equal(initialConfig({ CHAT_API_KEY: '  ' }).mode, 'unconfigured');
  assert.equal(initialConfig({ DASHSCOPE_API_KEY: 'speech-only' }).mode, 'unconfigured');
});
