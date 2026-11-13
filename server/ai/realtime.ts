import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { ClientOptions, RawData } from 'ws';
import { validateAudioUrl } from './config.ts';
import { voiceInstructions } from './voice.ts';
import { tools, executeTool, modelToolOutput } from './tools.ts';
import { guidePayload } from '../guide.ts';
import type { AudioProvider, Trace, ToolOutput } from './types.ts';
import { diagnosticSchema } from '../call-log.ts';
import type { CallJournal } from '../call-log.ts';

interface Options {
  client: WebSocket;
  provider: AudioProvider;
  connect?: (url: string, options: ClientOptions) => WebSocket;
  validateUrl?: typeof validateAudioUrl;
  onClose?: () => void;
  setupTimeoutMs?: number;
  journal?: CallJournal;
}
interface ResponseState {
  id: string;
  turn: number;
  cancelled: boolean;
  done: boolean;
  internal: boolean;
  parts: Map<string, { transcript?: string; text?: string }>;
  audio: Map<string, { bytes: number; index: number }>;
  calls: Map<string, { name: string; arguments: string }>;
}

/** A persistent, bidirectional call. Only this server can configure the model or execute tools. */
export function createRealtimeBridge({ client, provider, connect = (url, options) => new WebSocket(url, options),
  validateUrl = validateAudioUrl, onClose = () => {}, setupTimeoutMs = 25000, journal }: Options) {
  let upstream: WebSocket | null = null, closed = false, started = false, ready = false, configured = false;
  let turn = 0, speaking = false, currentId = '', rounds = 0, inputBytes = 0, windowStart = Date.now();
  let blockedThroughTurn = -1;
  let diagnostics = 0, diagnosticWindow = Date.now();
  let traces: Trace[] = [];
  let responseTimeout: ReturnType<typeof setTimeout> | undefined;
  const responses = new Map<string, ResponseState>();
  const cancellationEvents = new Set<string>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, delay: number) => { const timer = setTimeout(fn, delay); timers.add(timer); return timer; };
  function close(reason = 'closed') {
    if (closed) return;
    closed = true;
    for (const timer of timers) clearTimeout(timer);
    clearInterval(heartbeat);
    upstream?.terminate();
    client.close(1000, 'call ended');
    // A dead peer must not hold the API shutdown or a call slot open.
    const timer = setTimeout(() => client.terminate(), 1000); timer.unref();
    client.once('close', () => clearTimeout(timer));
    void journal?.close(reason);
    onClose();
  }
  function emit(event: Record<string, unknown>) {
    if (closed || client.readyState !== WebSocket.OPEN) return;
    if (client.bufferedAmount > 512 * 1024) { close('downstream-backpressure'); return; }
    journal?.record('browser.out', event, { turn });
    client.send(JSON.stringify(event));
  }
  function fail(code: string, message: string) { emit({ type: 'error', code, message }); close(code); }
  function send(event: Record<string, unknown>) {
    if (closed || upstream?.readyState !== WebSocket.OPEN) return '';
    if (upstream.bufferedAmount > 128 * 1024) { fail('network', '语音网络拥堵，请重新拨打。'); return ''; }
    const id = `evt_${randomUUID()}`;
    journal?.record('provider.out', { event_id: id, ...event }, { turn });
    upstream.send(JSON.stringify({ event_id: id, ...event }));
    return id;
  }
  function cancel(response: ResponseState | undefined) {
    if (!response || response.cancelled) return;
    response.cancelled = true;
    journal?.record('server', { type: 'response.cancel_requested', responseId: response.id, responseTurn: response.turn, generationDone: response.done }, { turn });
    response.calls.clear();
    if (!response.done && response.id === currentId) {
      const id = send({ type: 'response.cancel' });
      if (id) cancellationEvents.add(id);
      while (cancellationEvents.size > 32) cancellationEvents.delete(cancellationEvents.values().next().value!);
    }
  }
  const setup = later(() => fail('connection-timeout', '通话连接超时，请重新拨打。'), setupTimeoutMs);
  later(() => fail('session-expired', '本次通话已到时，请重新拨打。'), 30 * 60 * 1000);
  let alive = true, pingId = '';
  const heartbeat = setInterval(() => {
    if (!alive) { close('heartbeat-timeout'); return; }
    alive = false;
    pingId = randomUUID(); emit({ type: 'ping', id: pingId });
  }, 15000);
  heartbeat.unref();
  client.on('error', () => close('client-error'));
  client.on('close', (code, reason) => {
    journal?.record('server', { type: 'client.socket_closed', code, reason: reason?.toString().slice(0, 1000) }); close('client-disconnected');
  });

  async function start(context: unknown) {
    if (!provider.apiKey) { fail('unconfigured', '实时语音未配置，请配置服务端语音密钥。'); return; }
    try {
      const url = await validateUrl(provider.baseUrl);
      if (closed) return;
      url.searchParams.set('model', provider.model);
      const payload = guidePayload({ context });
      upstream = connect(url.toString(), { headers: { Authorization: `Bearer ${provider.apiKey}` },
        followRedirects: false, handshakeTimeout: 15000, maxPayload: 2 * 1024 * 1024 });
      upstream.on('error', error => {
        journal?.record('server', { type: 'provider.socket_error', name: error.name, message: error.message });
        fail('network', '实时语音连接失败，请检查网络与模型配置。');
      });
      upstream.on('unexpected-response', (_request, response) => {
        journal?.record('server', { type: 'provider.handshake_rejected', status: response.statusCode });
        response.resume(); fail('unavailable', '实时语音服务拒绝连接，请检查模型与权限。');
      });
      upstream.on('close', (code, reason) => {
        if (!closed) { journal?.record('server', { type: 'provider.socket_closed', code, reason: reason?.toString().slice(0, 1000) }); fail('network', '语音连接已断开，请重新拨打。'); }
      });
      upstream.on('message', (raw: RawData) => {
        if (closed) return;
        try {
          const event = JSON.parse(raw.toString());
          journal?.record('provider.in', event, { turn: event.type === 'input_audio_buffer.speech_started' ? turn + 1 : turn });
          if (event.type === 'error') {
            // server VAD can win the cancel race; only our own cancellation errors are benign.
            if (cancellationEvents.delete(event.error?.event_id)) { journal?.record('server', { type: 'cancel.race_ignored', eventId: event.error.event_id }); return; }
            fail('provider-error', '实时语音服务未能完成请求，请检查模型配置后重拨。'); return;
          }
          if (event.type === 'session.created' && !configured) {
            configured = true;
            send({ type: 'session.update', session: {
              modalities: ['text', 'audio'], voice: provider.voice,
              instructions: `${voiceInstructions(payload.city, payload.pageContext)}\n这是全双工电话。用户插话时立即让出话轮，只回应最新问题；安静等待用户说话，不主动问候或催促。`,
              input_audio_format: 'pcm', output_audio_format: 'pcm',
              // Verified against Qwen Audio 3.1: acoustic endpointing avoids long semantic waits.
              turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 450 },
              tools, max_history_turns: 20,
            } });
          }
          if (event.type === 'session.updated' && !ready) {
            for (const message of payload.messages) send({ type: 'conversation.item.create', item: {
              type: 'message', role: message.role,
              content: [{ type: message.role === 'user' ? 'input_text' : 'output_text', text: message.content }],
            } });
            ready = true; clearTimeout(setup);
            emit({ type: 'ready', model: provider.model, ...(journal ? { callId: journal.id, logging: true } : {}) });
          }
          if (event.type === 'input_audio_buffer.speech_started') {
            clearTimeout(responseTimeout);
            cancel(responses.get(currentId));
            turn++; rounds = 0; traces = []; speaking = true;
            emit({ type: 'speech_started', turn });
          }
          if (event.type === 'input_audio_buffer.speech_stopped') {
            speaking = false; emit({ type: 'speech_stopped', turn });
            clearTimeout(responseTimeout);
            responseTimeout = later(() => fail('response-timeout', '沐沐暂时没有回应，请重新拨打。'), 90000);
          }
          if (event.type === 'conversation.item.input_audio_transcription.completed' && typeof event.transcript === 'string') {
            emit({ type: 'transcript', itemId: event.item_id, text: event.transcript.slice(0, 20000) });
          }
          if (event.type === 'response.created') {
            const id = event.response?.id;
            if (typeof id !== 'string') throw new Error('Missing response ID');
            currentId = id;
            const response: ResponseState = { id, turn, cancelled: false, done: false, internal: false, parts: new Map(), audio: new Map(), calls: new Map() };
            responses.set(id, response);
            while (responses.size > 32) responses.delete(responses.keys().next().value!);
            if (speaking || turn <= blockedThroughTurn) cancel(response);
            else emit({ type: 'response_started', responseId: id, turn });
          }
          const id = event.response_id ?? event.response?.id;
          const response = responses.get(id);
          if (!response) return;
          if (event.type === 'response.done') response.done = true;
          if (response.cancelled || response.turn !== turn) {
            journal?.record('server', { type: 'response.event_dropped', eventType: event.type, responseId: id, reason: response.cancelled ? 'cancelled' : 'stale-turn' }, { turn }); return;
          }
          const meta = { responseId: id, turn: response.turn };
          // Suppress speech attached to the tool phase; tool execution and map effects still run.
          if (event.type === 'response.output_item.added' && event.item?.type === 'function_call'
            || event.type.startsWith('response.function_call_arguments.')) response.internal = true;
          if (response.internal && /^(response\.audio\.|response\.audio_transcript\.|response\.text\.)/.test(event.type)) {
            journal?.record('server', { type: 'response.event_dropped', eventType: event.type, responseId: id, reason: 'internal-tool-phase' }, { turn });
          }
          if (event.type === 'response.audio.delta' && !response.internal) {
            if (typeof event.delta !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(event.delta) || typeof event.item_id !== 'string') throw new Error('Invalid audio');
            const pcm = Buffer.from(event.delta, 'base64');
            const item = response.audio.get(event.item_id) ?? { bytes: 0, index: event.content_index ?? 0 };
            item.bytes += pcm.length;
            if (pcm.length % 2 || item.bytes > 24000 * 2 * 120) throw new Error('Audio too long');
            response.audio.set(event.item_id, item);
            emit({ type: 'audio', ...meta, itemId: event.item_id, contentIndex: item.index, audio: event.delta });
          }
          const textKind = event.type.startsWith('response.audio_transcript.') ? 'transcript' : event.type.startsWith('response.text.') ? 'text' : null;
          if (textKind && !response.internal) {
            const value = event.type.endsWith('.delta') ? event.delta : event[textKind];
            if (typeof value === 'string') {
              const key = `${event.item_id}:${event.content_index ?? 0}`;
              const part = response.parts.get(key) ?? {};
              part[textKind] = event.type.endsWith('.delta') ? (part[textKind] ?? '') + value : value;
              response.parts.set(key, part);
              const text = [...response.parts.values()].map(part => part.transcript || part.text || '').join('\n');
              if (text.length > 30000) throw new Error('Text too long');
              emit({ type: 'answer', ...meta, text });
            }
          }
          if (event.type === 'response.function_call_arguments.done') {
            if (typeof event.call_id !== 'string' || typeof event.name !== 'string' || typeof event.arguments !== 'string' || event.arguments.length > 65536) throw new Error('Invalid tool');
            response.calls.set(event.call_id, { name: event.name, arguments: event.arguments });
            if (response.calls.size > 8) throw new Error('Too many tools');
          }
          if (event.type === 'response.done') {
            if (event.response.status === 'cancelled') { cancel(response); emit({ type: 'response_cancelled', ...meta }); return; }
            if (event.response.status !== 'completed') throw new Error('Incomplete response');
            if (response.calls.size) {
              if (++rounds > 5) throw new Error('Too many tool rounds');
              for (const [callId, call] of response.calls) {
                const trace: Trace = { id: callId, name: call.name, args: {}, result: null, duration: 0, status: 'running' };
                const at = Date.now(); let output: ToolOutput | undefined;
                try { trace.args = JSON.parse(call.arguments); } catch { output = { error: '工具参数不是合法 JSON。' }; }
                journal?.record('server', { type: 'tool_start', ...meta, trace: { ...trace } });
                output ??= executeTool(call.name, trace.args);
                Object.assign(trace, { result: output, duration: Date.now() - at, status: output.error ? 'error' : 'done' });
                traces.push(trace); emit({ type: 'tool_end', ...meta, trace });
                send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(modelToolOutput(call.name, output)) } });
              }
              response.calls.clear();
              emit({ type: 'response_done', ...meta, continuing: true, traces });
              send({ type: 'response.create', response: { modalities: ['text', 'audio'] } });
            } else { clearTimeout(responseTimeout); emit({ type: 'response_done', ...meta, traces }); }
          }
        } catch { fail('protocol-error', '实时语音返回了无效数据，请重新拨打。'); }
      });
    } catch { fail('unavailable', '无法连接实时语音服务，请检查服务端配置。'); }
  }

  client.on('message', (raw: RawData, binary: boolean) => {
    if (closed) return;
    try {
      if (binary) {
        if (!ready) throw new Error('Not ready');
        const pcm = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
        if (!pcm.length || pcm.length % 2 || pcm.length > 6400) throw new Error('Invalid PCM');
        if (Date.now() - windowStart >= 1000) { inputBytes = 0; windowStart = Date.now(); }
        inputBytes += pcm.length;
        if (inputBytes > 128000) throw new Error('Input flooding');
        journal?.input(pcm, { turn });
        send({ type: 'input_audio_buffer.append', audio: pcm.toString('base64') });
        return;
      }
      const event = JSON.parse(raw.toString());
      if (event.type === 'diagnostic') {
        const parsed = diagnosticSchema.safeParse(event);
        if (!parsed.success || raw.toString().length > 8192) throw new Error('Invalid diagnostic');
        if (Date.now() - diagnosticWindow >= 1000) { diagnostics = 0; diagnosticWindow = Date.now(); }
        if (++diagnostics > 250) throw new Error('Diagnostic flooding');
        journal?.record('browser.in', parsed.data, { turn }); return;
      }
      journal?.record('browser.in', event, { turn });
      if (event.type === 'pong' && event.id === pingId) { alive = true; return; }
      if (event.type === 'start' && !started) { started = true; void start(event.context); return; }
      if (event.type === 'hangup') { close('hangup'); return; }
      if (!ready) throw new Error('Not ready');
      if (event.type === 'barge_in') {
        // A local onset invalidates even an in-flight response with no ID yet. Only cloud
        // speech_started advances turns; a delayed local notice cannot cancel that new turn.
        if (!Number.isInteger(event.turn) || event.turn < 0 || event.turn > turn) throw new Error('Invalid turn');
        if (event.turn !== turn || speaking) { journal?.record('server', { type: 'barge_in.ignored', requestedTurn: event.turn, reason: speaking ? 'cloud-already-speaking' : 'stale-turn' }, { turn }); return; }
        blockedThroughTurn = Math.max(blockedThroughTurn, event.turn);
        clearTimeout(responseTimeout);
        for (const response of responses.values()) if (response.turn <= blockedThroughTurn) cancel(response);
        return;
      }
      if (event.type === 'interrupt') {
        // IDs scope cancellation: a late playout acknowledgement cannot kill the next answer.
        const response = responses.get(event.responseId);
        if (!response) return;
        cancel(response);
        if (Array.isArray(event.played)) {
          for (const [itemId, audio] of response.audio) {
            const cursor = event.played.find((item: { itemId?: unknown }) => item?.itemId === itemId);
            const heard = Number.isFinite(cursor?.audioEndMs) ? Math.max(0, Math.floor(cursor.audioEndMs)) : 0;
            send({ type: 'conversation.item.truncate', item_id: itemId, content_index: audio.index,
              audio_end_ms: Math.min(heard, Math.floor(audio.bytes / 48)) });
          }
          response.audio.clear();
        }
        return;
      }
      if (event.type === 'context') {
        const payload = guidePayload({ context: event.context });
        send({ type: 'session.update', session: { instructions: `${voiceInstructions(payload.city, payload.pageContext)}\n用户插话就让出话轮，等待用户主动说话。` } });
        return;
      }
      throw new Error('Unsupported event');
    } catch { fail('invalid-request', '通话数据格式无效，请重新拨打。'); }
  });
  return { close };
}
