// Qwen realtime orchestration migrated from VirtourV2/server/voice.js.
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { ClientOptions, RawData } from 'ws';
import { validateAudioUrl } from './config.ts';
import { guideInstructions } from './llm.ts';
import { tools, executeTool } from './tools.ts';
import type { AgentInput, AgentResult, AudioProvider, ToolOutput, Trace } from './types.ts';

interface VoiceEvent {
  type: string;
  response_id?: string;
  item_id?: string;
  content_index?: number;
  response?: { id?: string; status?: string };
  transcript?: string;
  text?: string;
  delta?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
}
export interface VoiceInput extends AgentInput {
  provider: AudioProvider;
  audio: string;
  connect?: (url: string, options: ClientOptions) => WebSocket;
  validateUrl?: (url: string) => Promise<URL>;
  timeoutMs?: number;
}

export async function runVoice({ provider, audio, messages, city, pageContext, onEvent = () => {}, signal,
  connect = (url, options) => new WebSocket(url, options), validateUrl = validateAudioUrl, timeoutMs = 120000 }: VoiceInput): Promise<AgentResult> {
  if (signal?.aborted) throw new Error('请求已取消。');
  const url = await validateUrl(provider.baseUrl);
  if (signal?.aborted) throw new Error('请求已取消。');
  url.searchParams.set('model', provider.model);
  const pcm = Buffer.from(audio, 'base64');
  if (pcm.length < 3200 || pcm.length > 16000 * 2 * 60 || pcm.length % 2) throw new Error('音频必须为 0.1–60 秒的 16kHz、16bit 单声道 PCM。');

  return new Promise((resolve, reject) => {
    const socket = connect(url.toString(), { headers: { Authorization: `Bearer ${provider.apiKey}` }, followRedirects: false, handshakeTimeout: 15000, maxPayload: 2 * 1024 * 1024 });
    let settled = false, configured = false, submitted = false, committed = false;
    let toolRounds = 0, audioBytes = 0, responseId = '';
    const traces: Trace[] = [];
    const pendingCalls = new Map<string, { name: string; arguments: string }>();
    const handledCalls = new Set<string>();
    const parts = new Map<string, { transcript?: string; text?: string }>();
    const content = () => [...parts.values()].map(p => p.transcript || p.text || '').filter(Boolean).join('\n').trim();
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      socket.terminate();
      if (error) reject(error);
      else resolve({ content: content() || '（模型未返回文字字幕，请播放语音回答。）', traces });
    };
    const cancel = () => finish(new Error('请求已取消。'));
    const timer = setTimeout(() => finish(new Error('Qwen 原生语音响应超时，请重试。')), timeoutMs);
    const send = (event: Record<string, unknown>) => socket.send(JSON.stringify({ event_id: `evt_${randomUUID()}`, ...event }));
    const respond = () => send({ type: 'response.create', response: { modalities: ['audio', 'text'] } });
    const writeText = (event: VoiceEvent, field: 'transcript' | 'text', value: unknown, append = false) => {
      if (typeof value !== 'string') return;
      const key = `${event.response_id || responseId}:${event.item_id || 'message'}:${event.content_index || 0}`;
      const part = parts.get(key) || {};
      part[field] = append ? (part[field] || '') + value : value;
      parts.set(key, part);
      if (content().length > 30000) throw new Error('语音模型输出过长，请简化问题。');
      onEvent({ type: 'answer_delta', content: content() });
    };
    socket.on('unexpected-response', (_request, response) => {
      const status = response.statusCode;
      response.resume();
      finish(new Error(`Qwen 连接返回 ${status}：请检查模型地址、密钥、地域与权限。`));
    });
    socket.on('error', () => finish(new Error('Qwen WebSocket 连接失败，请检查地址、网络和模型配置。')));
    socket.on('close', () => { if (!settled) finish(new Error('Qwen 语音连接中断，未收到完整回答，请重试。')); });
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) { cancel(); return; }
    socket.on('message', (raw: RawData) => {
      if (settled) return;
      try {
        const event: VoiceEvent = JSON.parse(raw.toString());
        if (event.type === 'error') throw new Error('Qwen 拒绝了语音请求，请检查模型、音色、权限与接口配置。');
        if (event.type === 'session.created' && !configured) {
          configured = true;
          send({ type: 'session.update', session: {
            modalities: ['text', 'audio'], voice: provider.voice,
            instructions: `${guideInstructions(city, pageContext)}\n这是原生语音对话，请直接理解用户音频，并用简洁、自然的中文口语回答，不要使用 Markdown 或表情符号。\n每一轮新的用户音频都必须独立判断工具需求。历史字幕只帮助理解上下文，不是本轮查询结果。凡是本轮询问天气、景点、票价、行程、预算、文化或世界之窗资料，即使历史中有相似问题或答案，也必须在本轮重新调用对应工具，拿到结果后才可陈述具体数据；未得到本轮工具结果时只能说明尚未查询，不能复用、猜测或编造数据。`,
            input_audio_format: 'pcm', output_audio_format: 'pcm', turn_detection: null,
            tools, max_history_turns: 20,
          } });
        }
        if (event.type === 'session.updated' && configured && !submitted) {
          submitted = true;
          for (const message of messages) send({ type: 'conversation.item.create', item: {
            type: 'message', role: message.role,
            content: [{ type: message.role === 'user' ? 'input_text' : 'output_text', text: message.content }],
          } });
          onEvent({ type: 'status', message: 'Qwen 正在直接理解音频…' });
          for (let offset = 0; offset < pcm.length; offset += 3200) send({ type: 'input_audio_buffer.append', audio: pcm.subarray(offset, offset + 3200).toString('base64') });
          send({ type: 'input_audio_buffer.commit' });
        }
        if (event.type === 'input_audio_buffer.committed' && submitted && !committed) { committed = true; respond(); }
        if (event.type === 'conversation.item.input_audio_transcription.completed' && typeof event.transcript === 'string') onEvent({ type: 'input_transcript', transcript: event.transcript.slice(0, 20000) });
        if (event.type === 'response.created') responseId = event.response?.id || randomUUID();
        if (event.type === 'response.audio.delta') {
          if (typeof event.delta !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(event.delta)) throw new Error('模型返回了无效音频。');
          const chunk = Buffer.from(event.delta, 'base64');
          audioBytes += chunk.length;
          if (chunk.length % 2 || audioBytes > 24000 * 2 * 120) throw new Error('语音回答超过音频长度限制。');
          onEvent({ type: 'audio_delta', audio: event.delta, sampleRate: 24000 });
        }
        if (event.type === 'response.audio_transcript.delta') writeText(event, 'transcript', event.delta, true);
        if (event.type === 'response.audio_transcript.done') writeText(event, 'transcript', event.transcript);
        if (event.type === 'response.text.delta') writeText(event, 'text', event.delta, true);
        if (event.type === 'response.text.done') writeText(event, 'text', event.text);
        if (event.type === 'response.function_call_arguments.done' && !handledCalls.has(event.call_id || '')) {
          if (typeof event.call_id !== 'string' || typeof event.name !== 'string' || typeof event.arguments !== 'string') throw new Error('模型工具调用格式不正确。');
          pendingCalls.set(event.call_id, { name: event.name, arguments: event.arguments });
          if (pendingCalls.size > 8) throw new Error('语音模型单轮工具调用超过 8 次。');
        }
        if (event.type === 'response.done') {
          if (event.response?.status && event.response.status !== 'completed') throw new Error('Qwen 未能完成语音回答，请重试。');
          if (pendingCalls.size) {
            if (++toolRounds > 5) throw new Error('语音模型工具调用超过 5 轮，请简化问题。');
            for (const [id, call] of pendingCalls) {
              handledCalls.add(id);
              const start = Date.now();
              const trace: Trace = { id, name: call.name, args: {}, result: null, duration: 0, status: 'running' };
              let output: ToolOutput | undefined;
              try { trace.args = JSON.parse(call.arguments); }
              catch { output = { error: '工具调用参数不是合法 JSON。' }; }
              onEvent({ type: 'tool_start', trace: { ...trace } });
              output ||= executeTool(call.name, trace.args);
              Object.assign(trace, { result: output, duration: Date.now() - start, status: output.error ? 'error' : 'done' });
              traces.push(trace);
              onEvent({ type: 'tool_end', trace });
              send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: id, output: JSON.stringify(output) } });
            }
            pendingCalls.clear();
            onEvent({ type: 'status', message: 'Qwen 正在根据工具结果生成语音…' });
            respond();
          } else {
            if (!content() && !audioBytes) throw new Error('Qwen 未返回有效语音或文字回答，请重试。');
            finish();
          }
        }
      } catch (error) {
        finish(error instanceof SyntaxError ? new Error('Qwen 返回了不合法的事件数据。') : error instanceof Error ? error : new Error('语音处理失败。'));
      }
    });
  });
}
