import { validateBaseUrl } from './config.ts';
import type { AudioProvider } from './types.ts';

export type TtsEvent = { type: 'audio_delta'; audio: string; sampleRate: number; charIndex: number };
export interface TtsInput {
  text: string;
  provider: AudioProvider;
  signal: AbortSignal;
  onEvent: (event: TtsEvent) => void;
  fetchImpl?: typeof fetch;
}

/** Keep exact UTF-16 offsets for captions; Qwen limits each request to 600 characters. */
export function narrationSegments(text: string): { text: string; charIndex: number }[] {
  const parts: { text: string; charIndex: number }[] = [];
  for (const match of text.matchAll(/[^。！？!?\n]+[。！？!?\n]*|[。！？!?\n]+/g)) {
    let offset = match.index;
    const points = [...match[0]];
    while (points.length) {
      const chunk = points.splice(0, 600).join('');
      if (chunk.trim()) parts.push({ text: chunk, charIndex: offset });
      offset += chunk.length;
    }
  }
  return parts;
}

/** Aliyun's SSE audio.data is mono 24 kHz signed 16-bit PCM; never expose OSS URLs. */
export async function runTts({ text, provider, signal, onEvent, fetchImpl = fetch }: TtsInput): Promise<void> {
  await validateBaseUrl(provider.baseUrl);
  for (const segment of narrationSegments(text)) {
    signal.throwIfAborted();
    const response = await fetchImpl(provider.baseUrl, { method: 'POST', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json', 'X-DashScope-SSE': 'enable' },
      body: JSON.stringify({ model: provider.model, input: { text: segment.text, voice: provider.voice, language_type: 'Chinese' } }) });
    if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
      await response.body?.cancel();
      throw new Error('TTS_UPSTREAM_UNAVAILABLE');
    }
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '', bytes = 0, audioBytes = 0, finished = false;
    const consume = (frame: string) => {
      const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (!data || data === '[DONE]') return;
      const event = JSON.parse(data);
      if (event.code || event.status_code && event.status_code !== 200) throw new Error('TTS_UPSTREAM_ERROR');
      const audio = event.output?.audio?.data;
      if (audio) {
        if (typeof audio !== 'string' || audio.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(audio)) throw new Error('INVALID_TTS_AUDIO');
        const decoded = Buffer.from(audio, 'base64'), length = decoded.length;
        if (decoded.toString('base64') !== audio) throw new Error('INVALID_TTS_AUDIO');
        if (!length || length % 2) throw new Error('INVALID_TTS_AUDIO');
        audioBytes += length;
        signal.throwIfAborted();
        onEvent({ type: 'audio_delta', audio, sampleRate: 24000, charIndex: segment.charIndex });
      }
      if (event.output?.finish_reason === 'stop') finished = true;
    };
    try {
      while (true) {
        const { value, done } = await reader.read();
        bytes += value?.byteLength ?? 0;
        if (bytes > 16 * 1024 * 1024) throw new Error('TTS_AUDIO_TOO_LARGE');
        buffer += decoder.decode(value, { stream: !done });
        buffer = buffer.replace(/\r\n/g, '\n');
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) { consume(buffer.slice(0, end)); buffer = buffer.slice(end + 2); }
        if (done) break;
      }
      if (buffer.trim()) consume(buffer);
      if (!audioBytes || !finished) throw new Error('TTS_INCOMPLETE');
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
}
