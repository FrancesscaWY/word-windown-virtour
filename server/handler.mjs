import { readFile, realpath } from 'node:fs/promises';
import { resolve, relative, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backendUrl, backendStatus, readGuideInput, queryBackend, proxyVoice } from './backend.mjs';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': mime['.json'], 'Cache-Control': 'no-store' } });
}

export function createHandler({ root = projectRoot, dist = false, env = process.env, fetchImpl = fetch } = {}) {
  const upstream = backendUrl(env);
  return async function handleRequest(request) {
    const url = new URL(request.url);
    if (url.pathname === '/api/status') {
      if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
      const backend = await backendStatus({ url: upstream, fetchImpl, signal: request.signal });
      return json({
        stage: 'proactive-guide', ...backend,
        credentialsPresent: Boolean(env.GUIDE_API_KEY),
        asr: backend.nativeVoice?.ready ? 'backend-native' : 'unavailable', tts: backend.nativeVoice?.ready ? 'backend-native' : 'unavailable', localNarrationTts: 'browser',
        deployment: 'local', panorama: 'eiffel-demo-illustration', realParkPanorama: 'unavailable', photography: 'local-park-photos', catalog: 'sourced-partial-inventory',
      });
    }
    if (['/api/guide', '/api/voice'].includes(url.pathname)) {
      if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
      if (!upstream) return json({ error: 'GUIDE_NOT_CONFIGURED', message: '导游后端未配置，仍可使用本地景点指令。' }, 503);
      try {
        const voice = url.pathname === '/api/voice';
        const input = await readGuideInput(request, { voice });
        if (voice) return await proxyVoice(input, { url: upstream, fetchImpl, signal: request.signal });
        const answer = await queryBackend(input, { url: upstream, fetchImpl, signal: request.signal });
        return json({ status: 'success', ...answer });
      } catch (error) {
        const status = error.status ?? (error.name === 'TimeoutError' ? 504 : 502);
        return json({ error: status < 500 ? 'INVALID_GUIDE_REQUEST' : 'GUIDE_UNAVAILABLE',
          message: status < 500 ? error.message : status === 504 ? '导游回答超时，请稍后重试；仍可用本地指令浏览景点。' : '导游后端暂时无法完成回答，请稍后重试；仍可用本地指令浏览景点。' }, status);
      }
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'NOT_FOUND' }, 404);
    if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { return json({ error: 'BAD_PATH' }, 400); }
    if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').some((part) => part.startsWith('.'))) return json({ error: 'NOT_FOUND' }, 404);
    const isSource = pathname.startsWith('/src/');
    const base = resolve(root, dist ? 'dist' : isSource ? 'src' : 'public');
    const part = pathname === '/' ? 'index.html' : isSource && !dist ? pathname.slice(5) : pathname.slice(1);
    const target = resolve(base, part);
    const inside = (path) => { const rel = relative(base, path); return rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep); };
    if (!inside(target)) return json({ error: 'NOT_FOUND' }, 404);
    try {
      const actual = await realpath(target);
      if (!inside(actual)) return json({ error: 'NOT_FOUND' }, 404);
      const body = await readFile(actual);
      return new Response(request.method === 'HEAD' ? null : body, { headers: {
        'Content-Type': mime[extname(actual)] ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache',
        'Permissions-Policy': 'microphone=(self), camera=(), geolocation=(self)',
      } });
    } catch { return json({ error: 'NOT_FOUND' }, 404); }
  };
}
