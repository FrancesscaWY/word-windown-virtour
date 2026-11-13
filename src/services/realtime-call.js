import { createPcmPlayback } from './native-audio.js';
import { createCallVad } from './call-vad.js';
import { guideRequestContext as pageContext } from './guide-context.js';

const errorMessage = {
  NotAllowedError: '麦克风未获授权，请在浏览器站点权限中允许后重拨。',
  NotFoundError: '未找到麦克风，请连接麦克风后重拨。',
  NotReadableError: '麦克风被占用，请检查系统输入设备后重拨。',
};

/** The microphone never stops while the assistant is playing or using tools. */
export function createRealtimeCall({ scope = globalThis, onEvent = () => {}, createDetector = createCallVad } = {}) {
  let active = null, generation = 0;
  const now = () => scope.performance?.now() ?? Date.now();
  const release = stream => stream?.getTracks().forEach(track => track.stop());
  function send(task, event) {
    if (active !== task || task.socket?.readyState !== 1) return;
    task.socket.send(JSON.stringify(event));
  }
  function diagnostic(task, name, details = {}, clientMs = now() - task.started) {
    if (!task.callId) return;
    const values = { turn: task.turn, inputSamples: task.inputSamples, audioTimeMs: (task.context?.currentTime ?? 0) * 1000,
      ...details };
    send(task, { type: 'diagnostic', name, clientMs: Math.max(0, clientMs), details: Object.fromEntries(Object.entries(values)
      .filter(([, value]) => typeof value === 'boolean' || typeof value === 'string' || Number.isFinite(value))) });
  }
  function interrupt(task = active, responseId, reason = 'manual') {
    if (!task) return;
    // Include completed-generation audio that is still in the browser's playout queue.
    for (const [id, response] of task.responses) {
      if (responseId && id !== responseId) continue;
      if (response.cancelled || response.drained) continue;
      response.cancelled = true;
      const played = response.player?.played ?? [];
      response.player?.stop();
      diagnostic(task, 'playback_stopped', { responseId: id, reason, hadPlayer: Boolean(response.player),
        playedMs: played.reduce((sum, item) => sum + item.audioEndMs, 0), outputLatencyMs: (task.context.outputLatency || task.context.baseLatency || 0) * 1000 });
      send(task, { type: 'interrupt', responseId: id, played });
      onEvent({ type: 'interrupted', responseId: id });
    }
    if (!responseId || task.currentId === responseId) { task.currentId = ''; task.clock.nextTime = 0; }
  }
  function stop() {
    const task = active;
    if (!task) return;
    diagnostic(task, 'capture_stats', { packets: task.packets, muted: task.muted, maxCaptureGapMs: task.maxCaptureGapMs, final: true });
    interrupt(task, undefined, 'hangup');
    send(task, { type: 'hangup' });
    active = null; generation++;
    scope.clearTimeout(task.timeout); scope.clearInterval(task.watchdog);
    task.detector?.stop();
    scope.document?.removeEventListener('visibilitychange', task.visibility);
    task.capture?.port.close();
    for (const node of [task.source, task.capture, task.mute]) { try { node?.disconnect(); } catch {} }
    release(task.stream);
    task.socket?.close();
    if (task.context) { task.context.onstatechange = null; void task.context.close().catch(() => {}); }
  }
  function fail(task, message, code = 'network') {
    if (active !== task) return;
    diagnostic(task, 'error', { code, message });
    stop(); onEvent({ type: 'error', message, code });
  }
  return {
    get active() { return Boolean(active); },
    interrupt,
    stop,
    setMuted(muted) {
      if (!active) return;
      active.muted = Boolean(muted);
      active.detector?.reset();
      diagnostic(active, 'mute', { muted: Boolean(muted) });
      for (const track of active.stream?.getAudioTracks() ?? []) track.enabled = !muted;
    },
    updateContext(state) { if (active?.ready) send(active, { type: 'context', context: pageContext(state) }); },
    start(state) {
      stop();
      const task = { token: ++generation, started: now(), inputSamples: 0, packets: 0, maxCaptureGapMs: 0,
        responses: new Map(), clock: { nextTime: 0 }, currentId: '', turn: 0, blockedTurn: -1, serverSpeaking: false, muted: false, ready: false, lastPacket: 0 };
      active = task;
      const valid = () => active === task && task.token === generation;
      const AudioContext = scope.AudioContext || scope.webkitAudioContext;
      if (!scope.isSecureContext || scope.location?.protocol === 'file:' || !AudioContext || !scope.AudioWorkletNode || !scope.navigator?.mediaDevices?.getUserMedia || !scope.WebSocket) {
        fail(task, '实时通话需要 HTTPS 和支持 AudioWorklet 的现代浏览器。', 'unsupported'); return;
      }
      try {
        task.context = new AudioContext({ latencyHint: 'interactive' });
        const resumed = task.context.resume().catch(() => false); // preserve the tap's autoplay activation
        task.timeout = scope.setTimeout(() => fail(task, '麦克风授权或通话连接超时，请重拨。', 'connection-timeout'), 30000);
        void (async () => {
          try {
            const stream = await scope.navigator.mediaDevices.getUserMedia({ audio: {
              channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
            }, video: false });
            if (!valid()) { release(stream); return; }
            task.stream = stream;
            task.detector = createDetector({ scope,
              onError: message => fail(task, message, 'vad-error'),
              onSpeech(type, detection = {}) {
                if (!valid() || !task.ready || task.muted) return;
                const detectedMs = now() - task.started;
                if (type === 'speech_started') {
                  // Cloud may already have recognized this utterance. Never cancel its future answer.
                  if (!task.serverSpeaking) {
                    task.blockedTurn = Math.max(task.blockedTurn, task.turn);
                    interrupt(task, undefined, 'local-vad');
                    send(task, { type: 'barge_in', turn: task.turn });
                  }
                  onEvent({ type, source: 'local', turn: task.turn });
                } else if (!task.serverSpeaking) onEvent({ type, source: 'local', turn: task.turn });
                diagnostic(task, type === 'speech_started' ? 'vad_started' : 'vad_stopped', {
                  frameEndSample: detection.frameEndSample, boundarySample: detection.boundarySample,
                  boundaryClientMs: detection.boundaryClientMs, cloudSpeaking: task.serverSpeaking,
                }, detectedMs);
              },
            });
            await resumed;
            if (!valid()) return;
            if (task.context.state !== 'running') throw new Error('请允许浏览器播放声音后重拨。');
            await task.context.audioWorklet.addModule(new URL('./call-capture-worklet.js', import.meta.url));
            if (!await task.detector.ready) return;
            if (!valid()) return;
            task.capture = new scope.AudioWorkletNode(task.context, 'call-capture');
            task.source = task.context.createMediaStreamSource(stream);
            task.mute = task.context.createGain(); task.mute.gain.value = 0;
            task.source.connect(task.capture); task.capture.connect(task.mute); task.mute.connect(task.context.destination);
            for (const track of stream.getAudioTracks()) track.onended = () => fail(task, '麦克风连接已断开，请重拨。', 'audio-capture');
            task.context.onstatechange = () => {
              if (valid() && task.ready && task.context.state !== 'running') fail(task, '浏览器暂停了通话音频，请回到页面重拨。', 'audio-suspended');
            };
            const url = new URL('/api/voice/realtime', scope.location.href);
            url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
            const socket = task.socket = new scope.WebSocket(url.href);
            socket.onopen = () => { if (valid()) send(task, { type: 'start', context: pageContext(state) }); };
            socket.onerror = () => fail(task, '通话连接失败，请检查网络后重拨。');
            socket.onclose = () => { if (valid()) fail(task, '通话已断开，请重新拨打。'); };
            task.capture.port.onmessage = ({ data }) => {
              if (!valid()) return;
              task.lastPacket = Date.now();
              if (!task.ready || socket.readyState !== 1) return;
              if (socket.bufferedAmount > 32000) { fail(task, '上行网络拥堵，通话已结束，请重拨。'); return; }
              // Muted tracks produce silence. Sending it also closes a partially spoken turn.
              socket.send(task.muted ? new ArrayBuffer(data.byteLength) : data);
              const captureMs = now() - task.started;
              if (task.lastCaptureMs !== undefined) task.maxCaptureGapMs = Math.max(task.maxCaptureGapMs, captureMs - task.lastCaptureMs);
              task.lastCaptureMs = captureMs; task.inputSamples += data.byteLength / 2; task.packets++;
              if (!task.muted) task.detector.push(data, { sampleEnd: task.inputSamples, captureMs });
              if (task.packets % 100 === 0) {
                diagnostic(task, 'capture_stats', { packets: task.packets, muted: task.muted, maxCaptureGapMs: task.maxCaptureGapMs, bufferedBytes: socket.bufferedAmount });
                task.maxCaptureGapMs = 0;
              }
            };
            task.watchdog = scope.setInterval(() => {
              if (task.ready && Date.now() - task.lastPacket > 5000) fail(task, '浏览器已暂停麦克风，请重新拨打。', 'audio-suspended');
            }, 2000);
            socket.onmessage = ({ data }) => {
              if (!valid()) return;
              try {
                const event = JSON.parse(data);
                if (event.type === 'ping') { send(task, { type: 'pong', id: event.id }); return; }
                if (event.type === 'error') { fail(task, event.message, event.code); return; }
                if (event.type === 'ready') {
                  task.ready = true; task.callId = event.callId; task.lastPacket = Date.now(); scope.clearTimeout(task.timeout);
                  diagnostic(task, 'connected', { wallTimeMs: Date.now(), sampleRate: task.context.sampleRate,
                    outputLatencyMs: (task.context.outputLatency || task.context.baseLatency || 0) * 1000,
                    userAgent: (scope.navigator.userAgent ?? '').slice(0, 1000) });
                  task.visibility = () => diagnostic(task, 'visibility', { state: scope.document.visibilityState });
                  scope.document?.addEventListener('visibilitychange', task.visibility);
                  onEvent(event); return;
                }
                if (event.type === 'speech_started') { interrupt(task, undefined, 'cloud-vad'); task.turn = event.turn; task.serverSpeaking = true; diagnostic(task, 'cloud_speech_started'); onEvent(event); return; }
                if (event.type === 'speech_stopped') { task.serverSpeaking = false; diagnostic(task, 'cloud_speech_stopped'); onEvent(event); return; }
                if (event.type === 'transcript') { onEvent(event); return; }
                if (event.type === 'response_started') {
                  if (event.turn < task.turn || event.turn <= task.blockedTurn) {
                    send(task, { type: 'interrupt', responseId: event.responseId, played: [] }); return;
                  }
                  task.currentId = event.responseId;
                  task.responses.set(event.responseId, { cancelled: false, drained: false, player: null });
                  while (task.responses.size > 32) task.responses.delete(task.responses.keys().next().value);
                  onEvent(event); return;
                }
                const response = task.responses.get(event.responseId);
                if (!response || response.cancelled || event.turn < task.turn) {
                  if (event.type === 'audio') diagnostic(task, 'audio_dropped', { responseId: event.responseId, reason: response?.cancelled ? 'cancelled' : 'stale-or-unknown' });
                  return;
                }
                if (event.type === 'response_cancelled') { interrupt(task, event.responseId, 'provider-cancelled'); return; }
                if (event.type === 'audio') {
                  if (!response.player) response.player = createPcmPlayback(task.context, { scope, clock: task.clock, maxQueuedSeconds: 30,
                    onStart: () => { if (valid() && !response.cancelled) { diagnostic(task, 'playback_started', { responseId: event.responseId }); onEvent({ type: 'playback_started', responseId: event.responseId }); } } });
                  const schedule = response.player.append(event.audio, event);
                  if (schedule) diagnostic(task, 'playback_chunk', { responseId: event.responseId, itemId: event.itemId,
                    contentIndex: event.contentIndex ?? 0, ...schedule });
                } else if (event.type === 'response_done') {
                  response.player?.seal();
                  // Model done != speaker done. Do not report listening until the queue drains.
                  Promise.resolve(response.player?.done).then(() => {
                    response.drained = true;
                    if (valid() && !response.cancelled) diagnostic(task, 'playback_done', { responseId: event.responseId, hadPlayer: Boolean(response.player), continuing: Boolean(event.continuing) });
                    if (valid() && !response.cancelled && task.currentId === event.responseId) onEvent({ type: 'playback_done', responseId: event.responseId, continuing: event.continuing });
                  });
                  onEvent(event);
                } else onEvent(event);
              } catch (error) { fail(task, error.message || '通话音频处理失败，请重拨。', 'audio-error'); }
            };
          } catch (error) { if (valid()) fail(task, errorMessage[error.name] || error.message || '无法开启通话。', error.name === 'NotAllowedError' ? 'not-allowed' : 'start-failed'); }
        })();
      } catch { fail(task, '浏览器无法启动音频，请重拨。', 'start-failed'); }
    },
  };
}
