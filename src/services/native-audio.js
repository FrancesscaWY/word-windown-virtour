/** PCM wire format: mono signed 16-bit LE, input 16 kHz, output 24 kHz. */
export function encodePcm(samples, sourceRate, scope = globalThis) {
  const length = Math.floor(samples.length * 16000 / sourceRate);
  const bytes = new Uint8Array(length * 2), view = new DataView(bytes.buffer);
  for (let i = 0; i < length; i++) {
    // Average each input interval to reduce aliasing when downsampling microphone audio.
    const start = Math.floor(i * sourceRate / 16000), end = Math.max(start + 1, Math.floor((i + 1) * sourceRate / 16000));
    let value = 0;
    for (let j = start; j < end && j < samples.length; j++) value += samples[j];
    value = Math.max(-1, Math.min(1, value / (end - start)));
    view.setInt16(i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return scope.btoa(binary);
}

export async function consumeVoiceStream(response, onEvent) {
  if (!response.ok) throw new Error('语音后端暂时不可用，请稍后重试。');
  if (!response.body || !response.headers.get('content-type')?.includes('ndjson')) throw new Error('语音服务返回了无效响应。');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', answer = null, bytes = 0;
  const consume = line => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'error') throw new Error('后端未能完成语音回答，请稍后重试。');
    if (event.type === 'answer') {
      if (typeof event.content !== 'string' || !event.content.trim()) throw new Error('未收到完整语音字幕。');
      answer = event;
    }
    onEvent(event);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      bytes += value?.length ?? 0;
      if (bytes > 12 * 1024 * 1024) throw new Error('语音回答过长，请缩短问题后重试。');
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
      for (const line of lines) consume(line);
      if (done) break;
    }
    consume(buffer);
    if (!answer) throw new Error('语音连接中断，未收到完整回答。');
    return answer;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Queue PCM on the audio clock. Playback ends only after the last source ends. */
export function createPcmPlayback(context, { scope = globalThis, onStart = () => {} } = {}) {
  const nodes = new Set();
  let nextTime = 0, sealed = false, stopped = false, started = false, count = 0, startTimer = null;
  let settle;
  const done = new Promise(resolve => { settle = resolve; });
  const finish = () => { if (sealed && !nodes.size) settle({ status: count ? 'success' : 'error', error: count ? null : 'missing-audio' }); };
  return {
    done,
    append(base64) {
      if (stopped) return;
      const binary = scope.atob(base64);
      if (!binary.length || binary.length % 2) throw new Error('语音 PCM 数据不完整。');
      const buffer = context.createBuffer(1, binary.length / 2, 24000), samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) {
        let value = binary.charCodeAt(i * 2) | binary.charCodeAt(i * 2 + 1) << 8;
        if (value >= 32768) value -= 65536;
        samples[i] = value / 32768;
      }
      const node = context.createBufferSource(); node.buffer = buffer; node.connect(context.destination);
      const start = Math.max(context.currentTime + .03, nextTime);
      nextTime = start + buffer.duration; nodes.add(node); count++;
      node.onended = () => { nodes.delete(node); node.disconnect(); finish(); };
      node.start(start);
      if (!started && startTimer === null) {
        const confirmStart = () => {
          startTimer = null;
          if (stopped || started) return;
          if (context.state === 'running' && context.currentTime >= start) { started = true; onStart(); }
          else startTimer = scope.setTimeout(confirmStart, 20);
        };
        startTimer = scope.setTimeout(confirmStart, 35);
      }
    },
    seal() { sealed = true; finish(); },
    stop() {
      if (stopped) return;
      stopped = true; scope.clearTimeout(startTimer);
      for (const node of nodes) { node.onended = null; try { node.stop(); } catch {} node.disconnect(); }
      nodes.clear(); settle({ status: 'cancelled' });
    },
  };
}
