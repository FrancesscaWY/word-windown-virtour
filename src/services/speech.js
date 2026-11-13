import { createAliyunSpeechService } from './aliyun-speech.js';

/** Microphone adapter plus Aliyun narration. Cancellation always settles pending work. */
export function createSpeechService(scope = globalThis, { narration = createAliyunSpeechService(scope) } = {}) {
  const delay = scope.setTimeout?.bind(scope) ?? setTimeout;
  const clear = scope.clearTimeout?.bind(scope) ?? clearTimeout;
  let recognitionTask = null;
  let microphoneTask = null;
  let permissionState = 'unknown', permissionQueryState = 'unknown', lastMicrophoneError = null;
  const timer = (callback, ms) => { const id = delay(callback, ms); id?.unref?.(); return id; };

  function microphoneDiagnostics() {
    let microphonePolicy = null;
    try {
      const policy = scope.document?.permissionsPolicy ?? scope.document?.featurePolicy;
      if (policy?.allowsFeature) microphonePolicy = policy.allowsFeature('microphone');
    } catch { /* Older browsers may not expose this policy to scripts. */ }
    return {
      secureContext: Boolean(scope.isSecureContext),
      speechRecognition: Boolean(scope.SpeechRecognition || scope.webkitSpeechRecognition),
      mediaDevices: Boolean(scope.navigator?.mediaDevices?.getUserMedia),
      microphonePolicy, permissionState, permissionQueryState, lastError: lastMicrophoneError,
    };
  }
  function releaseStream(stream) {
    for (const track of stream?.getTracks?.() ?? []) {
      try { track.stop(); } catch { /* A disconnected track may already be stopped. */ }
    }
  }
  function microphoneError(error) {
    if (microphoneDiagnostics().microphonePolicy === false) return 'permission-policy';
    if (['NotAllowedError', 'PermissionDeniedError'].includes(error?.name)) return 'not-allowed';
    if (['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError'].includes(error?.name)) return 'audio-capture';
    if (['NotReadableError', 'TrackStartError', 'AbortError'].includes(error?.name)) return 'device-busy';
    if (error?.name === 'SecurityError') return 'permission-policy';
    return 'microphone-failed';
  }
  function queryMicrophonePermission() {
    try {
      const pending = scope.navigator?.permissions?.query?.({ name: 'microphone' });
      Promise.resolve(pending).then(status => {
        if (['granted', 'denied', 'prompt'].includes(status?.state)) permissionQueryState = status.state;
      }, () => { /* Firefox/WebViews may not support querying this permission. */ });
    } catch { /* The actual getUserMedia request remains the source of truth. */ }
  }

  function stopRecognition() {
    microphoneTask?.finish({ status: 'cancelled', text: '' });
    const task = recognitionTask;
    if (!task) return;
    task.finish({ status: 'cancelled', text: '' });
    try { task.instance?.abort(); } catch { /* already stopped */ }
  }
  function stopSpeaking() {
    narration.stopSpeaking();
  }

  return {
    provider: 'aliyun', unlock: () => narration.unlock?.(),
    dispose() { stopRecognition(); narration.dispose?.(); },
    stopRecognition, stopSpeaking,
    stop() { stopRecognition(); stopSpeaking(); },
    getMicrophoneDiagnostics: microphoneDiagnostics,
    /** Call from a visitor gesture. Permission queries never replace a real capture request. */
    requestMicrophone() {
      stopRecognition(); stopSpeaking();
      const diagnostics = microphoneDiagnostics();
      const unavailable = !diagnostics.secureContext ? 'insecure' : diagnostics.microphonePolicy === false ? 'permission-policy' : !diagnostics.mediaDevices ? 'microphone-unavailable' : null;
      if (unavailable) {
        lastMicrophoneError = unavailable;
        return Promise.resolve({ status: 'error', error: unavailable, diagnostics: microphoneDiagnostics() });
      }
      queryMicrophonePermission();
      return new Promise(resolve => {
        const task = { done: false, timeout: null, finish(result) {
          if (task.done) return;
          task.done = true; clear(task.timeout);
          if (microphoneTask === task) microphoneTask = null;
          if (result.error) lastMicrophoneError = result.error;
          resolve({ ...result, diagnostics: microphoneDiagnostics() });
        } };
        microphoneTask = task;
        task.timeout = timer(() => task.finish({ status: 'error', error: 'permission-timeout' }), 20000);
        try {
          // Invoke immediately, including when Permissions API reports denied:
          // only the browser can grant permission or enforce its saved refusal.
          const capture = scope.navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          Promise.resolve(capture).then(stream => {
            // A visitor may have paused while the permission prompt was open.
            // Always release late streams, and never start recognition from here.
            const audioTracks = stream?.getAudioTracks?.();
            const usable = Boolean(stream) && (!audioTracks || audioTracks.some(track => track.readyState !== 'ended'));
            releaseStream(stream);
            if (task.done) return;
            if (!usable) { task.finish({ status: 'error', error: 'audio-capture' }); return; }
            permissionState = 'granted'; lastMicrophoneError = null;
            task.finish({ status: 'granted' });
          }, error => {
            if (task.done) return;
            const code = microphoneError(error);
            if (code === 'not-allowed') permissionState = 'denied';
            task.finish({ status: 'error', error: code });
          });
        } catch (error) {
          const code = microphoneError(error);
          if (code === 'not-allowed') permissionState = 'denied';
          task.finish({ status: 'error', error: code });
        }
      });
    },
    recognizeOnce(onInterim = () => {}, { onStart = () => {} } = {}) {
      stopRecognition(); stopSpeaking();
      const Recognition = scope.SpeechRecognition || scope.webkitSpeechRecognition;
      if (!scope.isSecureContext || !Recognition) return Promise.resolve({ status: 'unsupported', error: !scope.isSecureContext ? 'insecure' : 'unsupported', text: '' });
      return new Promise(resolve => {
        let finalText = '', started = false;
        const task = { instance: null, timeout: null, done: false, finish(result) {
          if (task.done) return;
          task.done = true; clear(task.timeout);
          if (recognitionTask === task) recognitionTask = null;
          resolve(result);
        } };
        recognitionTask = task;
        const current = () => !task.done && recognitionTask === task;
        const expire = () => {
          task.finish(finalText.trim() ? { status: 'success', text: finalText.trim() } : started ? { status: 'empty', text: '' } : { status: 'error', error: permissionState === 'granted' ? 'recognition-timeout' : 'permission-timeout', text: '' });
          try { task.instance?.abort(); } catch { /* engine already ended */ }
        };
        try {
          const instance = new Recognition(); task.instance = instance;
          instance.lang = 'zh-CN'; instance.continuous = false; instance.interimResults = true; instance.maxAlternatives = 1;
          instance.onstart = () => {
            if (!current()) return;
            started = true; clear(task.timeout); task.timeout = timer(expire, 15000); onStart();
          };
          instance.onresult = event => {
            if (!current()) return;
            let interim = ''; finalText = '';
            // Results contain the complete current round; rebuilding prevents duplicate finals.
            for (let i = 0; i < event.results.length; i += 1) {
              const text = event.results[i][0]?.transcript ?? '';
              if (event.results[i].isFinal) finalText += text;
              else interim += text;
            }
            onInterim((finalText + interim).slice(0, 200));
            if (finalText.trim() && !interim) {
              clear(task.timeout); task.timeout = timer(expire, 1200);
              instance.stop?.();
            }
          };
          instance.onerror = event => {
            if (!current()) return;
            const error = event.error === 'not-allowed' && permissionState === 'granted' ? 'recognition-not-allowed' : event.error;
            task.finish(error === 'no-speech' && started ? { status: 'empty', text: '' } : { status: 'error', error: error === 'no-speech' ? 'recognition-not-started' : error, text: '' });
            try { instance.abort(); } catch { /* engine already ended */ }
          };
          instance.onend = () => {
            if (!current()) return;
            task.finish(finalText.trim() ? { status: 'success', text: finalText.trim() } : started ? { status: 'empty', text: '' } : { status: 'error', error: 'recognition-not-started', text: '' });
          };
          task.timeout = timer(expire, 15000);
          instance.start();
        } catch (error) {
          task.finish({ status: 'error', error: error?.name === 'NotAllowedError' ? permissionState === 'granted' ? 'recognition-not-allowed' : 'not-allowed' : 'start-failed', text: '' });
          try { task.instance?.abort(); } catch { /* failed before start */ }
        }
      });
    },
    speak(text, { onStart = () => {}, onBoundary = () => {} } = {}) {
      stopSpeaking(); stopRecognition();
      return narration.speak(text, { onStart, onBoundary });
    },
  };
}
