import { networkInterfaces } from 'node:os';
import { isIP } from 'node:net';

interface NetworkAddress { address: string | null; internal: boolean; family: string | number }
type Interfaces = Record<string, NetworkAddress[] | undefined>;
export interface ServerConfig {
  host: string;
  port: number;
  lan: boolean;
  dist: boolean;
  tls: { certPath: string; keyPath: string } | null;
  protocol: 'http' | 'https';
}

function readableInterfaces(): Interfaces {
  try { return networkInterfaces(); }
  catch { return {}; }
}

/** Explicit --lan wins over a copied .env HOST=127.0.0.1; normal dev stays local. */
export function readServerConfig({ env = process.env, argv = process.argv.slice(2) }: { env?: NodeJS.ProcessEnv; argv?: string[] } = {}): ServerConfig {
  const lan = argv.includes('--lan');
  const host = lan ? '0.0.0.0' : String(env.HOST ?? '').trim() || '127.0.0.1';
  const portValue = String(env.PORT ?? '').trim() || '5174';
  const port = Number(portValue);
  if (!/^\d+$/.test(portValue) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须为 1—65535 的整数');
  const certPath = String(env.TLS_CERT_PATH ?? '').trim();
  const keyPath = String(env.TLS_KEY_PATH ?? '').trim();
  if (Boolean(certPath) !== Boolean(keyPath)) throw new Error('TLS_CERT_PATH 和 TLS_KEY_PATH 必须同时配置；不会降级为 HTTP');
  const tls = certPath && keyPath ? { certPath, keyPath } : null;
  return { host, port, lan, dist: argv.includes('--dist'), tls, protocol: tls ? 'https' : 'http' };
}

/** Candidate local interface addresses. This never calls an external IP service or tunnel. */
export function getLanIpv4Addresses(interfaces: Interfaces = readableInterfaces()) {
  const found = new Map<string, { name: string; address: string }>();
  for (const [name, entries] of Object.entries(interfaces ?? {})) {
    for (const entry of entries ?? []) {
      if (!entry || entry.internal || !['IPv4', 4].includes(entry.family) || typeof entry.address !== 'string' || isIP(entry.address) !== 4) continue;
      const first = Number(entry.address.split('.')[0]);
      if (first === 0 || first === 127 || first >= 224) continue;
      if (!found.has(entry.address)) found.set(entry.address, { name, address: entry.address });
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.address.localeCompare(b.address, undefined, { numeric: true }));
}

function url(protocol: string, address: string, port: number): string {
  const host = isIP(address) === 6 ? `[${address}]` : address;
  return `${protocol}://${host}:${port}`;
}

/** Only advertise URLs that match the bind address, never 0.0.0.0 as a phone URL. */
export function getAccessUrls(config: ServerConfig, interfaces: Interfaces = readableInterfaces()) {
  const wildcard = config.host === '0.0.0.0' || config.host === '::';
  const localHost = wildcard ? '127.0.0.1' : config.host;
  const available = getLanIpv4Addresses(interfaces);
  const lan = (wildcard ? available : available.filter(entry => entry.address === config.host)).map(entry => ({ ...entry, url: url(config.protocol, entry.address, config.port) }));
  return { local: url(config.protocol, localHost, config.port), lan, wildcard };
}

export function formatStartupMessages(config: ServerConfig, interfaces: Interfaces = readableInterfaces()) {
  const access = getAccessUrls(config, interfaces);
  const lines = [`VirTour · 导览 Demo`, `电脑访问：${access.local}`];
  if (access.wildcard || access.lan.length) {
    if (access.lan.length) {
      lines.push('手机连接同一 Wi-Fi／热点后，使用电脑对应网卡的地址：');
      for (const entry of access.lan) lines.push(`  ${entry.url}  (${entry.name})`);
      lines.push('以上为本机网卡地址，不是公网隧道；虚拟网卡地址未必适用于手机。');
    } else lines.push('未检测到可用的非回环 IPv4。请连接 Wi-Fi／热点后重新启动，再查看手机访问地址。');
    if (access.wildcard) lines.push(`${config.host} 只是监听地址，不要在手机地址栏输入它。`);
    lines.push(config.tls ? 'HTTPS 已启用；手机需信任现有证书，证书也需覆盖所用 IP／主机名。' : 'HTTP 可测试地图、全景与文字交互；手机语音输入通常仍需受信任 HTTPS 和受支持的浏览器。');
  }
  return lines;
}
