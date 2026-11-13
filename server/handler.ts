import { readFile, realpath } from 'node:fs/promises';
import { resolve, relative, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary',
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': mime['.json'] } });

/** Static files only. API routing and lifecycle are owned by Fastify. */
export function createHandler({ root = projectRoot, dist = false }: { root?: string; dist?: boolean } = {}) {
  return async function handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return json({ error: 'NOT_FOUND' }, 404);
    if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    let pathname: string;
    try { pathname = decodeURIComponent(url.pathname); } catch { return json({ error: 'BAD_PATH' }, 400); }
    if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').some(part => part.startsWith('.'))) return json({ error: 'NOT_FOUND' }, 404);
    const isSource = pathname.startsWith('/src/');
    const base = resolve(root, dist ? 'dist' : isSource ? 'src' : 'public');
    const part = pathname === '/' ? 'index.html' : isSource && !dist ? pathname.slice(5) : pathname.slice(1);
    const target = resolve(base, part);
    const inside = (path: string) => { const rel = relative(base, path); return rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep); };
    if (!inside(target)) return json({ error: 'NOT_FOUND' }, 404);
    try {
      const actual = await realpath(target);
      if (!inside(actual)) return json({ error: 'NOT_FOUND' }, 404);
      const body = await readFile(actual);
      return new Response(request.method === 'HEAD' ? null : body, { headers: {
        'Content-Type': mime[extname(actual)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache',
        'Permissions-Policy': 'microphone=(self), camera=(), geolocation=(self)',
      } });
    } catch { return json({ error: 'NOT_FOUND' }, 404); }
  };
}
