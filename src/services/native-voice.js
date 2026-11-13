import { encodePcm, consumeVoiceStream, createPcmPlayback } from './native-audio.js';

/** Microphone capture and playback only; Qwen performs understanding and speech generation. */
export function createNativeVoiceService({ browserSpeech, scope = globalThis, fetchImpl = (...args) => scope.fetch(...args) } = {}) {
  let context = null, recording = null, responseTask = null, playback = null, cached = null, disposed = false, playbackVersion = 0;
  const AudioContext = scope.AudioContext || scope.webkitAudioContext;
  const release = stream => { for (const track of stream?.getTracks?.() ?? []) track.stop(); };
  const supportsRecognition = () => Boolean(scope.isSecureContext && AudioContext && scope.navigator?.mediaDevices?.getUserMedia && scope.location?.protocol !== 'file:');
  function unlock() {
    if (!AudioContext || disposed) return Promise.resolve(false);
    context ??= new AudioContext();
    return new Promise(resolve => {
      const timeout = scope.setTimeout(() => resolve(false), 1500);
      context.resume().then(() => { scope.clearTimeout(timeout); resolve(context.state === 'running'); }, () => { scope.clearTimeout(timeout); resolve(false); });
    });
  }
  function stopRecognition() { recording?.finish({ status: 'cancelled', text: '' }); browserSpeech.stopRecognition(); }
  function stopSpeaking() { playbackVersion++; responseTask?.abort(); playback?.stop(); playback = null; browserSpeech.stopSpeaking(); }
  async function recognizeOnce(onInterim = () => {}, { onStart = () => {} } = {}) {
    stopRecognition(); stopSpeaking();
    if (!supportsRecognition()) return { status: 'error', error: scope.isSecureContext ? 'unsupported' : 'insecure', text: '' };
    return new Promise(resolve => {
      const task = { done: false, stream: null, source: null, processor: null, mute: null, timeout: null, finish(result) {
        if (task.done) return;
        task.done = true; scope.clearTimeout(task.timeout);
        if (task.processor) task.processor.onaudioprocess = null;
        for (const node of [task.source, task.processor, task.mute]) { try { node?.disconnect(); } catch {} }
        release(task.stream); if (recording === task) recording = null;
        resolve(result);
      } };
      recording = task;
      const fail = code => task.finish({ status: 'error', error: code, text: '' });
      task.timeout = scope.setTimeout(() => fail('permission-timeout'), 20000);
      void (async () => {
        try {
          // Automatic entry may reuse a grant, but never opens a fresh permission prompt.
          let granted = browserSpeech.getMicrophoneDiagnostics().permissionState === 'granted';
          if (!granted) { try { granted = (await scope.navigator.permissions?.query({ name: 'microphone' }))?.state === 'granted'; } catch {} }
          if (task.done) return;
          if (!granted) { fail('permission-required'); return; }
          const stream = await scope.navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
          if (task.done) { release(stream); return; }
          task.stream = stream;
          if (!await unlock()) { fail('audio-playback-blocked'); return; }
          if (task.done) return;
          task.source = context.createMediaStreamSource(stream);
          task.processor = context.createScriptProcessor(4096, 1, 1);
          task.mute = context.createGain(); task.mute.gain.value = 0;
          task.source.connect(task.processor); task.processor.connect(task.mute); task.mute.connect(context.destination);
          const chunks = []; let frames = 0, voiced = 0, silent = 0, started = false;
          const finishAudio = () => {
            if (task.done) return;
            if (voiced < .15) { task.finish({ status: 'empty', text: '' }); return; }
            const samples = new Float32Array(frames); let offset = 0;
            for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
            task.finish({ status: 'success', audio: encodePcm(samples, context.sampleRate, scope) });
          };
          task.processor.onaudioprocess = event => {
            if (task.done) return;
            if (!started) { started = true; scope.clearTimeout(task.timeout); task.timeout = scope.setTimeout(finishAudio, 15000); onStart(); }
            const samples = new Float32Array(event.inputBuffer.getChannelData(0));
            chunks.push(samples); frames += samples.length;
            const duration = samples.length / context.sampleRate;
            const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
            if (rms > .012) { voiced += duration; silent = 0; }
            else silent += duration;
            if (voiced >= .15 && silent >= 1.1 || !voiced && frames / context.sampleRate >= 5) finishAudio();
          };
        } catch (error) {
          fail(['NotAllowedError', 'PermissionDeniedError'].includes(error.name) ? 'not-allowed' : error.name === 'NotFoundError' ? 'audio-capture' : error.name === 'NotReadableError' ? 'device-busy' : 'start-failed');
        }
      })();
    });
  }
  async function respondToAudio(audio, guideContext, { signal, onTranscript = () => {}, onAnswer = () => {}, onStart = () => {}, onToolEnd = () => {} } = {}) {
    stopSpeaking(); stopRecognition();
    const task = new AbortController(); responseTask = task;
    const combined = AbortSignal.any([task.signal, signal ?? new AbortController().signal, AbortSignal.timeout(125000)]);
    const chunks = [];
    const abortPlayback = () => playback?.stop();
    combined.addEventListener('abort', abortPlayback, { once: true });
    let player = null, answer = null;
    try {
      if (!await unlock()) throw new Error('请点击麦克风以允许播放后端语音。');
      if (combined.aborted) return { status: 'cancelled' };
      player = createPcmPlayback(context, { scope, onStart }); playback = player;
      const response = await fetchImpl('/api/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio, context: { messages: guideContext?.messages, selectedPoiId: guideContext?.selectedPoiId, mentionedPoiId: guideContext?.mentionedPoiId, view: guideContext?.view, plannedRoute: guideContext?.plannedRoute } }), signal: combined });
      answer = await consumeVoiceStream(response, event => {
        if (combined.aborted) return;
        if (event.type === 'input_transcript' && typeof event.transcript === 'string') onTranscript(event.transcript);
        if (event.type === 'audio_delta' && typeof event.audio === 'string') { chunks.push(event.audio); player.append(event.audio); }
        if (event.type === 'answer') onAnswer(event);
        if (event.type === 'tool_end') onToolEnd(event.trace);
      });
      if (combined.aborted) return { status: 'cancelled' };
      cached = { text: answer.content, chunks };
      player.seal();
      const result = await player.done;
      if (result.status !== 'success') return { ...result, answer };
      return { status: 'success', answer };
    } catch (error) {
      player?.stop();
      if (task.signal.aborted || signal?.aborted) return { status: 'cancelled' };
      throw error;
    } finally {
      combined.removeEventListener('abort', abortPlayback);
      if (responseTask === task) responseTask = null;
      if (playback === player) playback = null;
    }
  }
  return {
    provider: 'backend-native', supportsRecognition, unlock, recognizeOnce, respondToAudio,
    requestMicrophone() { void unlock(); return browserSpeech.requestMicrophone(); },
    getMicrophoneDiagnostics() { return { ...browserSpeech.getMicrophoneDiagnostics(), speechRecognition: supportsRecognition(), provider: 'backend-native' }; },
    stopRecognition, stopSpeaking, stop() { stopRecognition(); stopSpeaking(); },
    async speak(text, options = {}) {
      if (cached?.text !== text) return browserSpeech.speak(text, options);
      stopSpeaking(); stopRecognition();
      const version = playbackVersion;
      if (!await unlock()) return { status: 'error', error: 'audio-playback-blocked' };
      if (version !== playbackVersion || disposed) return { status: 'cancelled' };
      const player = createPcmPlayback(context, { scope, onStart: options.onStart }); playback = player;
      try { for (const chunk of cached.chunks) player.append(chunk); player.seal(); return await player.done; }
      catch { player.stop(); return { status: 'error' }; }
      finally { if (playback === player) playback = null; }
    },
    dispose() { disposed = true; stopRecognition(); stopSpeaking(); cached = null; void context?.close().catch(() => {}); context = null; },
  };
}
