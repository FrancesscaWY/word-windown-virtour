import { request as httpRequest } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import { Readable } from 'node:stream';
import type { FastifyRequest, FastifyReply } from 'fastify';

const hopHeaders = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];
function endToEndHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const result = { ...headers };
  for (const name of [...hopHeaders, ...(headers.connection || '').split(',').map(value => value.trim().toLowerCase())]) delete result[name];
  return result;
}

/** Stream without buffering/retries, cancelling upstream even before it sends headers.
 * The default reply-from transport only observes early cancellation after a response.
 */
export function proxyRequest(upstream: string, destination: string, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  return new Promise(resolve => {
    const queryIndex = request.url.indexOf('?');
    const headers = endToEndHeaders(request.headers);
    // Preserve the browser's authority and origin checks; never trust forwarded-host.
    headers.host = request.headers.host;
    headers.origin = request.headers.origin;
    headers['sec-fetch-site'] = request.headers['sec-fetch-site'];
    for (const name of Object.keys(headers)) if (headers[name] === undefined) delete headers[name];
    // An API may reject in onRequest before consuming a body. Do not reuse that
    // internal socket for another request with potentially unread upload bytes.
    const outgoing = httpRequest(upstream, { agent: false, method: request.method, path: destination + (queryIndex < 0 ? '' : request.url.slice(queryIndex)), headers });
    const cancel = () => { if (!reply.raw.writableFinished) outgoing.destroy(new Error('Client disconnected')); };
    const cleanup = () => {
      request.raw.removeListener('aborted', cancel);
      reply.raw.removeListener('close', cancel);
      reply.raw.removeListener('finish', cleanup);
    };
    request.raw.once('aborted', cancel);
    reply.raw.once('close', cancel);
    reply.raw.once('finish', cleanup);
    outgoing.setTimeout(130000, () => outgoing.destroy(new Error('Local API timeout')));
    outgoing.once('response', response => {
      if (reply.raw.destroyed) response.destroy();
      else {
        if (!request.raw.complete) reply.header('Connection', 'close');
        reply.code(response.statusCode || 502).headers(endToEndHeaders(response.headers)).send(response);
      }
      resolve();
    });
    outgoing.once('error', () => {
      cleanup();
      if (!reply.raw.destroyed && !reply.sent) reply.code(502).send({ error: 'API_UNAVAILABLE', message: '本地导览服务暂时不可用，请稍后重试。' });
      resolve();
    });
    if (request.raw.aborted || reply.raw.destroyed) { cancel(); return; }
    if (!['GET', 'HEAD'].includes(request.method)) {
      const payload = request.body instanceof Readable ? request.body : request.raw;
      payload.once('error', () => outgoing.destroy(new Error('Request body interrupted')));
      payload.pipe(outgoing);
    } else outgoing.end();
  });
}
