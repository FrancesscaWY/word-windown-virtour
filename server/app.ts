import Fastify from 'fastify';
import type { FastifyServerOptions } from 'fastify';
import { PassThrough } from 'node:stream';
import type { ServerOptions as HttpsOptions } from 'node:https';
import { initialConfig } from './ai/config.ts';
import { runAgent } from './ai/llm.ts';
import { runVoice } from './ai/voice.ts';
import { toolCatalog } from './ai/tools.ts';
import { createHandler } from './handler.ts';
import { guidePayload, validPcm } from './guide.ts';
import { abortable, createTurn } from './lifecycle.ts';
import { readPublicOrigins, isAllowedOrigin } from './origin.ts';
import type { AgentEvent, ModelConfig } from './ai/types.ts';

export interface AppOptions {
  env?: NodeJS.ProcessEnv;
  config?: ModelConfig;
  root?: string;
  dist?: boolean;
  serveStatic?: boolean;
  logger?: FastifyServerOptions['logger'];
  https?: HttpsOptions;
  agent?: typeof runAgent;
  voiceAgent?: typeof runVoice;
  guideTimeoutMs?: number;
  voiceTimeoutMs?: number;
}
interface GuideRequest { text: string; context?: unknown }
interface VoiceRequest { audio: string; context?: unknown }
const contextSchema = { type: 'object', additionalProperties: true };
const guideSchema = { type: 'object', required: ['text'], properties: { text: { type: 'string', minLength: 1, maxLength: 2000, pattern: '\\S' }, context: contextSchema }, additionalProperties: true };
const voiceSchema = { type: 'object', required: ['audio'], properties: { audio: { type: 'string', minLength: 4268, maxLength: 2560000 }, context: contextSchema }, additionalProperties: true };

export function createApp({ env = process.env, config = initialConfig(env), root, dist = false, serveStatic = true, logger = false, https,
  agent = runAgent, voiceAgent = runVoice, guideTimeoutMs = 60000, voiceTimeoutMs = 120000 }: AppOptions = {}) {
  const app = Fastify({ logger, ...(https ? { https } : {}), bodyLimit: 65536, requestTimeout: 150000, forceCloseConnections: true,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } } });
  const serve = createHandler({ root, dist });
  const publicOrigins = readPublicOrigins(env);
  let active = 0;
  const controllers = new Set<AbortController>();
  app.addHook('preClose', async () => { for (const controller of controllers) controller.abort(new Error('服务正在停止。')); });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    if (!request.url.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    const allowed = request.headers['sec-fetch-site'] !== 'cross-site' && isAllowedOrigin(request.headers.origin, request.headers.host, publicOrigins);
    if (!allowed) return reply.code(403).send({ error: 'CROSS_ORIGIN_DENIED', message: '不允许跨站访问导览 API。' });
    if (request.method === 'POST' && ['/api/guide', '/api/voice'].includes(request.url.split('?')[0]) && !/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
      return reply.code(415).send({ error: 'UNSUPPORTED_MEDIA_TYPE', message: '请使用 JSON 提交问题。' });
    }
  });
  app.setErrorHandler((error, request, reply) => {
    const failure = error instanceof Error ? error as Error & { statusCode?: number; code?: string } : new Error('Unknown error');
    const statusCode = 'statusCode' in failure ? failure.statusCode : undefined;
    const status = typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500 ? statusCode : 500;
    request.log.warn({ code: 'code' in failure ? failure.code : undefined }, 'Request rejected');
    reply.code(status).send({ error: status === 413 ? 'BODY_TOO_LARGE' : status === 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST',
      message: status === 413 ? '上传内容过大。' : status === 500 ? '服务暂时不可用。' : '请求格式或参数不合法。' });
  });
  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/tools', async () => toolCatalog);
  app.get('/api/status', async () => ({
    stage: 'proactive-guide', guide: config.text.apiKey ? 'connected' : 'unconfigured', mode: config.mode,
    model: config.text.model,
    nativeVoice: { ready: Boolean(config.audio.apiKey), model: config.audio.model, voice: config.audio.voice },
    credentialsPresent: Boolean(config.text.apiKey || config.audio.apiKey),
    asr: config.audio.apiKey ? 'backend-native' : 'unavailable', tts: config.audio.apiKey ? 'backend-native' : 'unavailable', localNarrationTts: 'browser',
    deployment: 'local', providerStatus: 'configuration-only',
    panorama: 'eiffel-demo-illustration', realParkPanorama: 'unavailable', photography: 'local-park-photos', catalog: 'sourced-partial-inventory',
  }));

  app.post<{ Body: GuideRequest }>('/api/guide', { schema: { body: guideSchema }, bodyLimit: 65536 }, async (request, reply) => {
    if (!config.text.apiKey) return reply.code(503).send({ error: 'GUIDE_NOT_CONFIGURED', message: '真实 AI 未配置，请在服务端配置 Chat API Key；不会返回演示回答。' });
    if (active >= 3) return reply.code(429).send({ error: 'BUSY', message: '当前请求较多，请稍后再试。' });
    const turn = createTurn(request, reply, guideTimeoutMs);
    controllers.add(turn.controller); active++;
    try {
      const payload = guidePayload(request.body);
      const result = await abortable(() => agent({ ...payload, provider: config.text, signal: turn.controller.signal }), turn.controller.signal);
      if (!result.content?.trim()) throw new Error('EMPTY_ANSWER');
      return { status: 'success', text: result.content, traces: result.traces, usage: result.usage,
        model: config.text.model, mode: 'live' };
    } catch {
      const timeout = turn.controller.signal.reason instanceof DOMException && turn.controller.signal.reason.name === 'TimeoutError';
      return reply.code(timeout ? 504 : 502).send({ error: timeout ? 'GUIDE_TIMEOUT' : 'GUIDE_UNAVAILABLE', message: timeout ? '导游回答超时，请稍后重试；仍可用本地指令浏览景点。' : '导游后端暂时无法完成回答，请检查模型配置；仍可用本地指令浏览景点。' });
    } finally { turn.cleanup(); controllers.delete(turn.controller); active--; }
  });

  app.post<{ Body: VoiceRequest }>('/api/voice', { schema: { body: voiceSchema }, bodyLimit: 3 * 1024 * 1024 }, async (request, reply) => {
    if (!validPcm(request.body.audio)) return reply.code(400).send({ error: 'INVALID_PCM', message: '录音需要为 0.1—60 秒的 16kHz、16bit 单声道 PCM。' });
    if (!config.audio.apiKey) return reply.code(503).send({ error: 'VOICE_NOT_CONFIGURED', message: '请在服务端配置 DASHSCOPE_API_KEY 以启用原生语音。' });
    if (active >= 3) return reply.code(429).send({ error: 'BUSY', message: '当前请求较多，请稍后再试。' });
    const turn = createTurn(request, reply, voiceTimeoutMs);
    controllers.add(turn.controller); active++;
    const output = new PassThrough();
    const emit = (event: AgentEvent) => {
      if (output.destroyed || turn.controller.signal.aborted) return;
      const line = `${JSON.stringify(event)}\n`;
      if (output.writableLength + output.readableLength + reply.raw.writableLength + Buffer.byteLength(line) > 2 * 1024 * 1024) {
        turn.controller.abort(new Error('慢客户端积压过多音频。'));
        output.destroy();
        return;
      }
      output.write(line);
    };
    output.on('close', () => { if (!output.readableEnded) turn.controller.abort(new Error('输出已关闭。')); });
    reply.type('application/x-ndjson; charset=utf-8').header('X-Accel-Buffering', 'no').send(output);
    emit({ type: 'mode', mode: 'native_audio' });
    emit({ type: 'status', message: '正在连接 Qwen 原生语音模型…' });
    void (async () => {
      try {
        const result = await abortable(() => voiceAgent({ ...guidePayload(request.body), audio: request.body.audio,
          provider: config.audio, onEvent: emit, signal: turn.controller.signal }), turn.controller.signal);
        if (!result.content?.trim()) throw new Error('EMPTY_ANSWER');
        emit({ type: 'answer', ...result, model: config.audio.model });
      } catch {
        // After headers, errors belong to the event stream. Never echo upstream text.
        if (!output.destroyed) output.write(`${JSON.stringify({ type: 'error', code: turn.controller.signal.aborted ? 'VOICE_CANCELLED_OR_TIMEOUT' : 'VOICE_UNAVAILABLE', error: '原生语音未能完成，请检查模型配置或稍后重试。' })}\n`);
      } finally {
        output.end(); turn.cleanup(); controllers.delete(turn.controller); active--;
      }
    })();
    return reply;
  });

  app.setNotFoundHandler(async (request, reply) => {
    const path = request.url.split('?')[0];
    if (path.startsWith('/api/')) return reply.code(['/api/guide', '/api/voice', '/api/status', '/api/tools', '/api/health'].includes(path) ? 405 : 404).send({ error: 'NOT_FOUND_OR_METHOD_NOT_ALLOWED' });
    if (!serveStatic) return reply.code(404).send({ error: 'NOT_FOUND' });
    const response = await serve(new Request(new URL(request.url, 'http://localhost'), { method: request.method }));
    return reply.code(response.status).headers(Object.fromEntries(response.headers)).send(response.body ? Buffer.from(await response.arrayBuffer()) : null);
  });
  return app;
}
