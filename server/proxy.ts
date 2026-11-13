import Fastify from 'fastify';
import type { FastifyServerOptions } from 'fastify';
import httpProxy from '@fastify/http-proxy';
import type { ServerOptions as HttpsOptions } from 'node:https';
import { createApp } from './app.ts';
import type { AppOptions } from './app.ts';
import { createHandler } from './handler.ts';
import { proxyRequest } from './proxy-transport.ts';

interface ProxyOptions {
  root?: string;
  dist?: boolean;
  https?: HttpsOptions;
  logger?: FastifyServerOptions['logger'];
  backendOptions?: Omit<AppOptions, 'https' | 'serveStatic' | 'root' | 'dist'>;
}

/** One public entry, with an API-only upstream bound to an ephemeral loopback port. */
export async function createProxy({ root, dist = false, https, logger = false, backendOptions = {} }: ProxyOptions = {}) {
  const backend = createApp({ ...backendOptions, serveStatic: false });
  const proxy = Fastify({ logger, ...(https ? { https } : {}), bodyLimit: 3 * 1024 * 1024, requestTimeout: 150000, forceCloseConnections: true });
  const serve = createHandler({ root, dist });
  proxy.addHook('preClose', async () => { await backend.close(); });
  try {
    const upstream = await backend.listen({ port: 0, host: '127.0.0.1' });
    await proxy.register(httpProxy, {
      upstream, prefix: '/api', rewritePrefix: '/api',
      // Custom transport preserves cancellation before text model response headers.
      // The plugin still owns prefix routing, payload streaming and path validation.
      handler: (request, reply, destination) => proxyRequest(upstream, destination, request, reply),
    });
    proxy.setNotFoundHandler(async (request, reply) => {
      const response = await serve(new Request(new URL(request.url, 'http://localhost'), { method: request.method }));
      return reply.code(response.status).headers(Object.fromEntries(response.headers)).send(response.body ? Buffer.from(await response.arrayBuffer()) : null);
    });
    await proxy.ready();
    return { proxy, backend };
  } catch (error) {
    await proxy.close();
    await backend.close();
    throw error;
  }
}
