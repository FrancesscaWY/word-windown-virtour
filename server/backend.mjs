import { getPoi } from '../src/data/pois.js';

export const DEFAULT_BACKEND_URL = 'https://v.direct.apricityx.top:55555/';
export const MAX_REQUEST_BYTES = 65536;

export function backendUrl(env = process.env) {
  const value = String(env.GUIDE_BACKEND_URL ?? DEFAULT_BACKEND_URL).trim();
  if (!value) return null;
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid GUIDE_BACKEND_URL');
  return url;
}

export async function readGuideInput(request, { voice = false } = {}) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw Object.assign(new Error('请使用 JSON 提交问题。'), { status: 415 });
  if (!request.body) throw Object.assign(new Error('请输入问题。'), { status: 400 });
  const reader = request.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > (voice ? 3 * 1024 * 1024 : MAX_REQUEST_BYTES)) throw Object.assign(new Error('问题内容过长。'), { status: 413 });
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('问题格式不正确。'), { status: 400 }); }
  if (voice) {
    const audio = input?.audio;
    if (typeof audio !== 'string' || audio.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) throw Object.assign(new Error('请提交有效的 PCM 音频。'), { status: 400 });
    const size = Buffer.from(audio, 'base64').length;
    if (size < 3200 || size > 1920000 || size % 2) throw Object.assign(new Error('录音需要为 0.1—60 秒的 16kHz 单声道 PCM。'), { status: 400 });
    return input;
  }
  if (!input || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 2000) throw Object.assign(new Error('请输入 1—2000 字的问题。'), { status: 400 });
  return input;
}

export function chatPayload(input) {
  const context = input.context ?? {};
  const history = (Array.isArray(context.messages) ? context.messages : []).slice(-10)
    .filter(row => row && ['user', 'assistant'].includes(row.role) && typeof (row.content ?? row.text) === 'string')
    .map(row => ({ role: row.role, content: (row.content ?? row.text).slice(0, 2000) }));
  const poi = getPoi(context.mentionedPoiId ?? context.selectedPoiId);
  const page = { park: '深圳世界之窗', view: context.view === 'map' ? '园区地图' : '景点画面',
    topic: poi ? { name: poi.name, summary: poi.summary, source: poi.source } : null };
  return { city: '深圳', messages: [...history, { role: 'user', content: `${input.text.trim()}

【导览页面上下文】${JSON.stringify(page)}
请以深圳世界之窗数字导游的身份用简洁中文回答。世界之窗相关问题优先检索知识库，保留来源与时效限制。没有实时人流、排队数据或可用步行路线，不编造距离、票价、营业时间；不能声称已操作当前页面。` }] };
}

/** NDJSON can split inside a UTF-8 character or event; only a final answer counts. */
export async function readChatAnswer(response) {
  if (!response.body || !response.headers.get('content-type')?.includes('ndjson')) throw new Error('INVALID_BACKEND_RESPONSE');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', size = 0, answer = null;
  const consume = line => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'error') throw new Error('BACKEND_STREAM_ERROR');
    if (event.type === 'answer') {
      if (typeof event.content !== 'string' || !event.content.trim()) throw new Error('EMPTY_BACKEND_ANSWER');
      answer = { text: event.content, model: typeof event.model === 'string' ? event.model : null,
        traces: Array.isArray(event.traces) ? event.traces : [] };
    }
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      size += value?.byteLength ?? 0;
      if (size > 2 * 1024 * 1024) throw new Error('BACKEND_RESPONSE_TOO_LARGE');
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
      for (const line of lines) consume(line);
      if (done) break;
    }
    consume(buffer);
    if (!answer) throw new Error('INCOMPLETE_BACKEND_ANSWER');
    return answer;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function queryBackend(input, { url, fetchImpl = fetch, signal } = {}) {
  const response = await fetchImpl(new URL('api/chat', url), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(chatPayload(input)),
    signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(60000)]),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error('BACKEND_REQUEST_FAILED'); }
  return readChatAnswer(response);
}

export async function backendStatus({ url, fetchImpl = fetch, signal } = {}) {
  if (!url) return { guide: 'unconfigured', mode: 'local-rules' };
  try {
    const response = await fetchImpl(new URL('api/config', url), { signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(5000)]) });
    if (!response.ok) { await response.body?.cancel(); throw new Error('BACKEND_STATUS_FAILED'); }
    const config = await response.json();
    if (!['live', 'demo'].includes(config.mode)) throw new Error('INVALID_BACKEND_CONFIG');
    return { guide: 'connected', mode: config.mode, model: config.text?.model ?? null, nativeVoice: { ready: config.audio?.hasKey === true, model: config.audio?.model ?? null, voice: config.audio?.voice ?? null } };
  } catch { return { guide: 'unavailable', mode: 'local-rules' }; }
}

/** Keep native audio events streaming through the same origin. */
export async function proxyVoice(input, { url, fetchImpl = fetch, signal } = {}) {
  const payload = chatPayload({ text: '以下是当前导览上下文，请回答本次录音中的问题。', context: input.context });
  const response = await fetchImpl(new URL('api/voice', url), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, audio: input.audio }),
    signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(120000)]),
  });
  if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('ndjson')) {
    await response.body?.cancel(); throw new Error('VOICE_BACKEND_FAILED');
  }
  return new Response(response.body, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Accel-Buffering': 'no' } });
}
