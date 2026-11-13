import { URL } from 'node:url';

function parseOrigin(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.hostname.includes('*')) throw new Error('Invalid origin');
  return url.origin;
}

/** Explicit origins handle trusted TLS/tunnel deployments that rewrite Host.
 * Never derive this allowlist from forwarded headers supplied by a requester.
 */
export function readPublicOrigins(env: NodeJS.ProcessEnv): Set<string> {
  try {
    return new Set((env.PUBLIC_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean).map(parseOrigin));
  } catch { throw new Error('PUBLIC_ORIGINS 必须为完整 HTTP/HTTPS Origin，不得包含通配符、凭据或路径。'); }
}

export function isAllowedOrigin(origin: string | undefined, host: string | undefined, publicOrigins: ReadonlySet<string>): boolean {
  if (!origin) return true;
  try {
    const normalized = parseOrigin(origin);
    return new URL(normalized).host === host?.toLowerCase() || publicOrigins.has(normalized);
  } catch { return false; }
}
