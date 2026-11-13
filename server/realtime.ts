import type { FastifyInstance } from 'fastify';
import { WebSocketServer } from 'ws';
import { createRealtimeBridge } from './ai/realtime.ts';
import { readPublicOrigins, isAllowedOrigin } from './origin.ts';
import type { AudioProvider } from './ai/types.ts';
import { resolve } from 'node:path';
import { projectRoot } from './handler.ts';
import { createCallJournal } from './call-log.ts';
import type { CallJournal } from './call-log.ts';

export function registerRealtime(app: FastifyInstance, { env, provider, bridge = createRealtimeBridge }: {
  env: NodeJS.ProcessEnv; provider: AudioProvider; bridge?: typeof createRealtimeBridge;
}) {
  const server = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
  const origins = readPublicOrigins(env);
  const calls = new Set<ReturnType<typeof createRealtimeBridge>>();
  const logClosures = new Set<Promise<void>>();
  let closing = false;
  app.server.on('upgrade', (request, socket, head) => {
    const reject = (status: number) => { socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); };
    if (request.url !== '/api/voice/realtime') { reject(404); return; }
    if (!request.headers.origin || request.headers['sec-fetch-site'] === 'cross-site' || !isAllowedOrigin(request.headers.origin, request.headers.host, origins)) { reject(403); return; }
    if (closing || calls.size >= 3) { reject(503); return; }
    server.handleUpgrade(request, socket, head, client => {
      let call: ReturnType<typeof createRealtimeBridge> | undefined;
      let journal: CallJournal | undefined;
      try {
        journal = createCallJournal({ root: env.CALL_LOG_DIR || resolve(projectRoot, 'logs/calls'), model: provider.model, voice: provider.voice,
          secrets: [provider.apiKey], onError: () => {
            app.log.error({ callId: journal?.id }, 'Call journal write failed');
            if (client.readyState === 1) client.send(JSON.stringify({ type: 'error', code: 'logging-error', message: '通话日志保存失败，请检查服务端存储后重拨。' }));
            call?.close('logging-error');
          },
        });
        call = bridge({ client, provider, journal, onClose: () => {
          if (call) calls.delete(call);
          const done = journal!.close(); logClosures.add(done); void done.finally(() => logClosures.delete(done));
        } });
        calls.add(call);
        app.log.info({ callId: journal.id }, 'Call journal started');
      } catch {
        void journal?.close('setup-failed');
        client.send(JSON.stringify({ type: 'error', code: 'logging-error', message: '无法创建通话日志，请检查服务端存储后重拨。' })); client.close();
      }
    });
  });
  app.addHook('preClose', async () => { closing = true; for (const call of calls) call.close('server-shutdown'); await Promise.allSettled([...logClosures]); });
  app.addHook('onClose', async () => { server.close(); });
}
