/** Worker lifecycle is owned by the call; no second microphone or external asset host. */
export function createCallVad({ scope = globalThis, onSpeech = () => {}, onError = () => {} } = {}) {
  let stopped = false, epoch = 0, pending = 0, initialized = false, settle;
  const ready = new Promise(resolve => { settle = resolve; });
  const worker = new scope.Worker(new URL('./call-vad-worker.js', import.meta.url), { type: 'module', name: 'call-vad' });
  const stop = () => { if (stopped) return; stopped = true; scope.clearTimeout(timeout); worker.terminate(); settle(false); };
  const fail = () => { if (stopped) return; stop(); onError('本地语音检测不可用，请重新拨打。'); };
  const timeout = scope.setTimeout(fail, 20000);
  worker.onerror = fail;
  worker.onmessage = ({ data }) => {
    if (stopped) return;
    if (data.type === 'ready') { initialized = true; scope.clearTimeout(timeout); settle(true); return; }
    if (data.type === 'error') { fail(); return; }
    if (data.epoch !== epoch) return;
    if (data.type === 'consumed') { pending--; return; }
    if (data.type === 'speech_started' || data.type === 'speech_stopped') onSpeech(data.type, data);
  };
  return {
    ready, stop,
    reset() { if (stopped) return; pending = 0; worker.postMessage({ type: 'reset', epoch: ++epoch }); },
    push(pcm, { sampleEnd, captureMs } = {}) {
      if (stopped || !initialized) return;
      // Never accumulate seconds of stale detection on an overloaded/backgrounded device.
      if (++pending > 16) { fail(); return; }
      const copy = pcm.slice(0);
      worker.postMessage({ type: 'pcm', pcm: copy, epoch, sampleEnd, captureMs }, [copy]);
    },
  };
}
