// Migrated from VirtourV2/server/config.js. Configuration is server-side only.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { readFileSync, lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { parseEnv } from 'node:util';
import type { ModelConfig } from './types.ts';

export function initialConfig(env: NodeJS.ProcessEnv = process.env): ModelConfig {
  let credentials: NodeJS.ProcessEnv = {};
  if (env.AI_CREDENTIALS_FILE) {
    try {
      if (!isAbsolute(env.AI_CREDENTIALS_FILE)) throw new Error();
      const stat = lstatSync(env.AI_CREDENTIALS_FILE);
      if (!stat.isFile() || stat.size > 16384 || (stat.mode & 0o077) || (process.getuid && stat.uid !== process.getuid())) throw new Error();
      credentials = parseEnv(readFileSync(env.AI_CREDENTIALS_FILE, 'utf8'));
    } catch { throw new Error('凭据文件不可用或权限不安全，请使用当前用户拥有的私有文件。'); }
  }
  const textKey = (env.CHAT_API_KEY ?? credentials.CHAT_API_KEY ?? env.DEEPSEEK_API_KEY ?? credentials.DEEPSEEK_API_KEY ?? '').trim();
  const audioKey = (env.DASHSCOPE_API_KEY ?? credentials.DASHSCOPE_API_KEY ?? '').trim();
  return {
    mode: textKey ? 'live' : 'unconfigured',
    text: { baseUrl: env.CHAT_BASE_URL || env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com', model: env.CHAT_MODEL || env.DEEPSEEK_MODEL || 'deepseek-flash', apiKey: textKey },
    audio: { baseUrl: env.QWEN_REALTIME_URL || 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime', model: env.QWEN_AUDIO_MODEL || 'qwen-audio-3.1-realtime-flash', voice: env.QWEN_VOICE || 'longanqian_v3.1', apiKey: audioKey },
    tts: { baseUrl: env.QWEN_TTS_URL || 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation', model: env.QWEN_TTS_MODEL || 'qwen3-tts-flash', voice: env.QWEN_TTS_VOICE || 'Cherry', apiKey: audioKey },
  };
}

export function isPrivateAddress(address: string): boolean {
  if (address.includes(':')) {
    const a = address.toLowerCase();
    return !/^[23][0-9a-f]{3}:/.test(a) || a.startsWith('2001:db8:');
  }
  const [a, b] = address.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
}

export async function validateBaseUrl(baseUrl: string, protocol = 'https:'): Promise<URL> {
  const url = new URL(baseUrl);
  if (url.protocol !== protocol || url.username || url.password || url.search || url.hash) throw new Error('模型地址必须为不含凭据、查询参数的公网 HTTPS / WSS 地址。');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some(a => isPrivateAddress(a.address))) throw new Error('不允许使用本机、内网或特殊用途地址作为模型端点。');
  return url;
}

export const validateAudioUrl = (baseUrl: string) => validateBaseUrl(baseUrl, 'wss:');
