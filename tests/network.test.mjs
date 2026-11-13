import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readServerConfig, getLanIpv4Addresses, getAccessUrls, formatStartupMessages } from '../server/network.ts';
import { createHandler } from '../server/handler.ts';

const interfaces = {
  lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
  wlan0: [
    { address: '192.168.43.20', family: 'IPv4', internal: false },
    { address: 'fe80::1234', family: 'IPv6', internal: false },
  ],
  eth0: [{ address: '10.0.0.8', family: 4, internal: false }],
};

test('normal development stays loopback while --lan overrides a copied loopback HOST', () => {
  assert.deepEqual(readServerConfig({ env: {}, argv: [] }), { host: '127.0.0.1', port: 5174, lan: false, dist: false, tls: null, protocol: 'http' });
  const config = readServerConfig({ env: { HOST: '127.0.0.1', PORT: '8080' }, argv: ['--lan', '--dist'] });
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.port, 8080);
  assert.equal(config.dist, true);
  assert.equal(config.lan, true);
  assert.equal(readServerConfig({ env: { HOST: ' 192.168.1.2 ' }, argv: [] }).host, '192.168.1.2');
});

test('ports are checked before binding and blank values keep the documented default', () => {
  for (const PORT of ['0', '-1', '65536', '5173oops', '1.5', '1e3']) assert.throws(() => readServerConfig({ env: { PORT }, argv: [] }), /PORT/);
  for (const PORT of ['1', '65535']) assert.equal(readServerConfig({ env: { PORT }, argv: [] }).port, Number(PORT));
  assert.equal(readServerConfig({ env: { PORT: ' ' }, argv: [] }).port, 5174);
});

test('LAN URLs use actual interface IPv4 values and never publish the wildcard bind address', () => {
  const config = readServerConfig({ env: {}, argv: ['--lan'] });
  assert.deepEqual(getLanIpv4Addresses(interfaces), [
    { name: 'eth0', address: '10.0.0.8' },
    { name: 'wlan0', address: '192.168.43.20' },
  ]);
  const access = getAccessUrls(config, interfaces);
  assert.equal(access.local, 'http://127.0.0.1:5174');
  assert.deepEqual(access.lan.map(entry => entry.url), ['http://10.0.0.8:5174', 'http://192.168.43.20:5174']);
  assert.ok(access.lan.every(entry => !entry.url.includes('0.0.0.0')));
  const log = formatStartupMessages(config, interfaces).join('\n');
  assert.match(log, /同一 Wi-Fi／热点/);
  assert.match(log, /手机语音输入通常仍需受信任 HTTPS/);
});

test('invalid, duplicate, loopback and multicast addresses are not advertised as phone endpoints', () => {
  const entries = [
    { address: '192.168.43.20', family: 'IPv4', internal: false },
    { address: '127.0.0.2', family: 'IPv4', internal: false },
    { address: '0.0.0.0', family: 'IPv4', internal: false },
    { address: '224.1.1.1', family: 'IPv4', internal: false },
    { address: '255.255.255.255', family: 'IPv4', internal: false },
    { address: '999.1.1.1', family: 'IPv4', internal: false },
    { address: null, family: 'IPv4', internal: false },
  ];
  const found = getLanIpv4Addresses({ ...interfaces, duplicate: entries, empty: undefined });
  assert.equal(found.length, 2);
  assert.equal(new Set(found.map(entry => entry.address)).size, 2);
});

test('loopback startup does not suggest inaccessible LAN endpoints, and missing interfaces are explicit', () => {
  const local = readServerConfig({ env: {}, argv: [] });
  assert.deepEqual(getAccessUrls(local, interfaces).lan, []);
  assert.ok(!formatStartupMessages(local, interfaces).join('\n').includes('192.168.43.20'));
  const lan = readServerConfig({ env: {}, argv: ['--lan'] });
  assert.match(formatStartupMessages(lan, { lo: interfaces.lo }).join('\n'), /未检测到可用的非回环 IPv4/);
  const specific = readServerConfig({ env: { HOST: '192.168.43.20' }, argv: [] });
  assert.equal(getAccessUrls(specific, interfaces).lan.length, 1);
});

test('existing HTTPS paths must be paired, preserve HTTPS URLs, and stay out of startup logs', () => {
  assert.throws(() => readServerConfig({ env: { TLS_CERT_PATH: '/cert.pem' }, argv: [] }), /必须同时配置/);
  assert.throws(() => readServerConfig({ env: { TLS_KEY_PATH: '/key.pem' }, argv: [] }), /不会降级/);
  const config = readServerConfig({ env: { TLS_CERT_PATH: '/private/cert.pem', TLS_KEY_PATH: '/private/key.pem', TEST_SECRET: 'never-print-this' }, argv: ['--lan'] });
  assert.equal(config.protocol, 'https');
  assert.equal(getAccessUrls(config, interfaces).lan[0].url, 'https://10.0.0.8:5174');
  const logs = formatStartupMessages(config, interfaces).join('\n');
  assert.match(logs, /证书也需覆盖/);
  for (const secret of ['/private/', 'never-print-this', 'TLS_KEY_PATH']) assert.ok(!logs.includes(secret));
  const ipv6 = readServerConfig({ env: { HOST: '::1' }, argv: [] });
  assert.equal(getAccessUrls(ipv6, interfaces).local, 'http://[::1]:5174');
});

test('LAN script is explicit and local startup does not silently expose other interfaces', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts['dev:lan'], /server\/index\.ts --lan$/);
  assert.ok(!pkg.scripts.dev.includes('--lan'));
  assert.match(pkg.dependencies.fastify, /5/);
});

test('the same handler still blocks environment, TLS and server paths on a LAN origin', async () => {
  const handle = createHandler();
  for (const path of ['/.env', '/.env.example', '/server/network.ts', '/server/index.ts', '/cert.pem', '/key.pem', '/assets/%2e%2e%2f.env']) {
    const response = await handle(new Request(`http://192.168.43.20:5173${path}`));
    assert.equal(response.status, 404, path);
  }
  assert.equal((await handle(new Request('http://192.168.43.20:5173/'))).status, 200);
});
