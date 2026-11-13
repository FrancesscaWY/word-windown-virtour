import Fastify from 'fastify';
import type { FastifyServerOptions } from 'fastify';
import { PassThrough } from 'node:stream';
import type { ServerOptions as HttpsOptions } from 'node:https';
import { initialConfig } from './ai/config.ts';
import { runAgent } from './ai/llm.ts';
import { runVoice } from './ai/voice.ts';
import { toolCatalog } from './ai/tools.ts';
import { createHandler, projectRoot } from './handler.ts';
import { resolve } from 'node:path';
import { createChatJournal, diagnosticError } from './chat-log.ts';
import type { ChatJournal, ChatOutcome } from './chat-log.ts';
import { guidePayload, validPcm } from './guide.ts';
import { abortable, createTurn } from './lifecycle.ts';
import { readPublicOrigins, isAllowedOrigin } from './origin.ts';
import { registerRealtime } from './realtime.ts';
import { createRealtimeBridge } from './ai/realtime.ts';
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
  realtimeBridge?: typeof createRealtimeBridge;
  guideTimeoutMs?: number;
  voiceTimeoutMs?: number;
}
interface GuideRequest { text: string; context?: unknown }
interface VoiceRequest { audio: string; context?: unknown }
interface ChatLogState { journal: ChatJournal; outcome?: ChatOutcome; result: Record<string, unknown>; handling: boolean }
const contextSchema = { type: 'object', additionalProperties: true };
const guideSchema = { type: 'object', required: ['text'], properties: { text: { type: 'string', minLength: 1, maxLength: 2000, pattern: '\\S' }, context: contextSchema }, additionalProperties: true };
const voiceSchema = { type: 'object', required: ['audio'], properties: { audio: { type: 'string', minLength: 4268, maxLength: 2560000 }, context: contextSchema }, additionalProperties: true };

export function createApp({ env = process.env, config = initialConfig(env), root, dist = false, serveStatic = true, logger = false, https,
  agent = runAgent, voiceAgent = runVoice, realtimeBridge = createRealtimeBridge, guideTimeoutMs = 60000, voiceTimeoutMs = 120000 }: AppOptions = {}) {
  const app = Fastify({ logger, ...(https ? { https } : {}), bodyLimit: 65536, requestTimeout: 150000, forceCloseConnections: true,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } } });
  const serve = createHandler({ root, dist });
  const publicOrigins = readPublicOrigins(env);
  registerRealtime(app as unknown as import('fastify').FastifyInstance, { env, provider: config.audio, bridge: realtimeBridge });
  let active = 0;
  const controllers = new Set<AbortController>();
  const reportChatLogFailure = (requestId: string, message: string) => {
    if (!logger || app.log.level === 'silent') console.error(`${message} (requestId=${requestId})`);
    else app.log.error({ requestId }, message);
  };
  const chatLogs = new WeakMap<object, ChatLogState>();
  const logClosures = new Set<Promise<void>>();
  function finishChat(request: object, httpStatus: number) {
    const state = chatLogs.get(request);
    if (!state) return;
    chatLogs.delete(request);
    const done = state.journal.close({ ...state.result, httpStatus,
      outcome: state.outcome ?? (httpStatus < 400 ? 'success' : 'rejected') });
    logClosures.add(done); void done.finally(() => logClosures.delete(done));
  }
  app.addHook('preClose', async () => { for (const controller of controllers) controller.abort(new Error('服务正在停止。')); });
  app.addHook('onClose', async () => { await Promise.allSettled([...logClosures]); });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    if (!request.url.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    if (request.method === 'POST' && request.url.split('?')[0] === '/api/guide') {
      try {
        const journal = createChatJournal({ root: env.CHAT_LOG_DIR || resolve(projectRoot, 'logs/chats'),
          requestId: request.id, model: config.text.model, secrets: [config.text.apiKey, config.audio.apiKey],
          onError: () => reportChatLogFailure(request.id, 'Chat journal write failed; chat continues') });
        const state: ChatLogState = { journal, result: {}, handling: false };
        chatLogs.set(request, state);
        reply.raw.once('close', () => {
          if (reply.raw.writableFinished) return;
          state.outcome = 'cancelled';
          journal.record({ type: 'client.disconnected' });
          if (!state.handling) finishChat(request, 499);
        });
      } catch { reportChatLogFailure(request.id, 'Chat journal could not be created; chat continues'); }
    }
    const allowed = request.headers['sec-fetch-site'] !== 'cross-site' && isAllowedOrigin(request.headers.origin, request.headers.host, publicOrigins);
    if (!allowed) {
      chatLogs.get(request)?.journal.record({ type: 'request.rejected', code: 'CROSS_ORIGIN_DENIED' });
      return reply.code(403).send({ error: 'CROSS_ORIGIN_DENIED', message: '不允许跨站访问导览 API。' });
    }
    if (request.method === 'POST' && ['/api/guide', '/api/voice'].includes(request.url.split('?')[0]) && !/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
      chatLogs.get(request)?.journal.record({ type: 'request.rejected', code: 'UNSUPPORTED_MEDIA_TYPE' });
      return reply.code(415).send({ error: 'UNSUPPORTED_MEDIA_TYPE', message: '请使用 JSON 提交问题。' });
    }
  });
  app.addHook('onResponse', async (request, reply) => { finishChat(request, reply.statusCode); });
  app.setErrorHandler((error, request, reply) => {
    const failure = error instanceof Error ? error as Error & { statusCode?: number; code?: string } : new Error('Unknown error');
    const statusCode = 'statusCode' in failure ? failure.statusCode : undefined;
    const status = typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500 ? statusCode : 500;
    request.log.warn({ code: 'code' in failure ? failure.code : undefined }, 'Request rejected');
    const log = chatLogs.get(request);
    if (log) {
      log.outcome = status === 500 ? 'error' : 'rejected';
      log.journal.record({ type: 'request.rejected', error: diagnosticError(failure), httpStatus: status });
    }
    reply.code(status).send({ error: status === 413 ? 'BODY_TOO_LARGE' : status === 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST',
      message: status === 413 ? '上传内容过大。' : status === 500 ? '服务暂时不可用。' : '请求格式或参数不合法。' });
  });
  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/tools', async () => toolCatalog);
  app.get('/api/status', async () => ({
    stage: 'proactive-guide', guide: config.text.apiKey ? 'connected' : 'unconfigured', mode: config.mode,
    model: config.text.model,
    nativeVoice: { ready: Boolean(config.audio.apiKey), model: config.audio.model, voice: config.audio.voice, fullDuplex: true },
    credentialsPresent: Boolean(config.text.apiKey || config.audio.apiKey),
    asr: config.audio.apiKey ? 'backend-native' : 'unavailable', tts: config.audio.apiKey ? 'backend-native' : 'unavailable', localNarrationTts: 'browser',
    deployment: 'local', providerStatus: 'configuration-only',
    panorama: 'eiffel-demo-illustration', realParkPanorama: 'unavailable', photography: 'local-park-photos', catalog: 'sourced-partial-inventory',
  }));

  app.post<{ Body: GuideRequest }>('/api/guide', { schema: { body: guideSchema }, bodyLimit: 65536 }, async (request, reply) => {
    const log = chatLogs.get(request);
    const payload = guidePayload(request.body);
    log?.journal.record({ type: 'request.input', ...payload });
    if (log) log.result.question = request.body.text.trim();
    if (!config.text.apiKey) {
      log?.journal.record({ type: 'request.rejected', code: 'GUIDE_NOT_CONFIGURED' });
      return reply.code(503).send({ error: 'GUIDE_NOT_CONFIGURED', message: '真实 AI 未配置，请在服务端配置 Chat API Key；不会返回演示回答。' });
    }
    if (active >= 3) {
      log?.journal.record({ type: 'request.rejected', code: 'BUSY' });
      return reply.code(429).send({ error: 'BUSY', message: '当前请求较多，请稍后再试。' });
    }
    if (log) log.handling = true;
    const turn = createTurn(request, reply, guideTimeoutMs);
    controllers.add(turn.controller); active++;
    try {
      const result = await abortable(() => agent({ ...payload, provider: config.text, signal: turn.controller.signal,
        onEvent: event => log?.journal.record(event), onDiagnostic: event => log?.journal.record(event) }), turn.controller.signal);
      if (!result.content?.trim()) throw new Error('EMPTY_ANSWER');
      log?.journal.record({ type: 'answer', ...result });
      if (log) { log.outcome = 'success'; Object.assign(log.result, { answer: result.content, usage: result.usage,
        tools: result.traces.map(trace => ({ name: trace.name, status: trace.status, durationMs: trace.duration })) }); }
      return { status: 'success', text: result.content, traces: result.traces, usage: result.usage,
        model: config.text.model, mode: 'live' };
    } catch (error) {
      const timeout = turn.controller.signal.reason instanceof DOMException && turn.controller.signal.reason.name === 'TimeoutError';
      if (log) {
        log.outcome = timeout ? 'timeout' : turn.controller.signal.aborted ? 'cancelled' : 'error';
        log.result.error = diagnosticError(error);
        log.journal.record({ type: 'request.error', outcome: log.outcome, error: log.result.error,
          ...(turn.controller.signal.aborted ? { abortReason: diagnosticError(turn.controller.signal.reason) } : {}) });
      }
      return reply.code(timeout ? 504 : 502).send({ error: timeout ? 'GUIDE_TIMEOUT' : 'GUIDE_UNAVAILABLE', message: timeout ? '导游回答超时，请稍后重试；仍可用本地指令浏览景点。' : '导游后端暂时无法完成回答，请检查模型配置；仍可用本地指令浏览景点。' });
    } finally {
      turn.cleanup(); controllers.delete(turn.controller); active--;
      if (log) log.handling = false;
      if (reply.raw.destroyed) finishChat(request, 499);
    }
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
