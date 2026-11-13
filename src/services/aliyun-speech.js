import { consumeVoiceStream, createPcmPlayback } from './native-audio.js';

/** Fixed-text narration uses server-side Aliyun TTS, never the OS/browser voice. */
export function createAliyunSpeechService(scope = globalThis) {
  const AudioContext = scope.AudioContext || scope.webkitAudioContext;
  let context = null, task = null;
  async function unlock(signal) {
    if (!AudioContext) return false;
    try {
      context ??= new AudioContext();
      const audioContext = context;
      return await new Promise(resolve => {
        const finish = value => { scope.clearTimeout(timeout); signal?.removeEventListener('abort', cancel); resolve(value); };
        const cancel = () => finish(false);
        const timeout = scope.setTimeout(cancel, 1500);
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) { cancel(); return; }
        try { Promise.resolve(audioContext.resume()).then(() => finish(audioContext.state === 'running'), cancel); }
        catch { cancel(); }
      });
    } catch { return false; }
  }
  function stopSpeaking() { task?.finish({ status: 'cancelled' }); }
  return {
    provider: 'aliyun', unlock, stopSpeaking,
    speak(text, { onStart = () => {}, onBoundary = () => {} } = {}) {
      stopSpeaking();
      if (!AudioContext || !scope.fetch || scope.location?.protocol === 'file:') return Promise.resolve({ status: 'unsupported' });
      if (typeof text !== 'string' || !text.trim() || text.length > 4000) return Promise.resolve({ status: 'error', error: 'invalid-text' });
      return new Promise(resolve => {
        const controller = new AbortController(), timers = new Set();
        const current = { done: false, player: null, finish(result) {
          if (current.done) return;
          current.done = true;
          controller.abort(); current.player?.stop();
          for (const id of timers) scope.clearTimeout(id);
          if (task === current) task = null;
          resolve(result);
        } };
        task = current;
        const schedule = (callback, ms) => {
          const id = scope.setTimeout(() => { timers.delete(id); if (!current.done) callback(); }, ms);
          timers.add(id);
        };
        schedule(() => current.finish({ status: 'error', error: 'timeout' }), 180000);
        void (async () => {
          try {
            // Invoke resume before the first await, retaining the visitor gesture.
            const ready = unlock(controller.signal);
            if (!await ready) { current.finish({ status: 'error', error: 'audio-playback-blocked' }); return; }
            if (current.done) return;
            const player = createPcmPlayback(context, { scope, onStart }); current.player = player;
            const response = await scope.fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text }), signal: controller.signal });
            let lastIndex = -1;
            await consumeVoiceStream(response, event => {
              if (current.done || event.type !== 'audio_delta') return;
              if (event.sampleRate !== 24000 || typeof event.audio !== 'string' || !Number.isInteger(event.charIndex) || event.charIndex < 0 || event.charIndex >= text.length) throw new Error('invalid-audio');
              const timing = player.append(event.audio);
              if (event.charIndex === lastIndex) return;
              lastIndex = event.charIndex;
              const cue = () => {
                if (context.state === 'running' && context.currentTime * 1000 >= timing.startTimeMs) onBoundary(event.charIndex);
                else schedule(cue, 20);
              };
              schedule(cue, Math.max(0, timing.startTimeMs - context.currentTime * 1000));
            });
            if (current.done) return;
            player.seal();
            current.finish(await player.done);
          } catch { current.finish({ status: 'error', error: 'tts-unavailable' }); }
        })();
      });
    },
    dispose() { stopSpeaking(); void context?.close().catch(() => {}); context = null; },
  };
}
