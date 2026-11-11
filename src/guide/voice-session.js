import { getBrowserCapabilities } from '../services/capabilities.js';

const BUSY = new Set(['requesting', 'listening', 'thinking', 'waiting', 'preparing', 'speaking']);
const ERRORS = {
  'permission-required': '点击麦克风允许录音，即可与后端语音导游交流。',
  'audio-playback-blocked': '请点击麦克风允许音频播放后重试。',
  'not-allowed': '浏览器拒绝了麦克风访问。请在地址栏的站点权限中允许浏览器使用麦克风，再点话筒重试；网页无法替你解除已保存的拒绝。',
  'recognition-not-allowed': '麦克风已获准，但浏览器仍拒绝启动语音识别。请在普通 Chrome 或 Edge 中打开，检查站点语音权限后重试，或使用文字。',
  'service-not-allowed': '浏览器不允许使用语音识别服务。可在普通 Chrome 或 Edge 中打开重试；麦克风授权不代表识别服务可用，打字也能继续逛。',
  'audio-capture': '没有找到可用的麦克风，检查连接后再试试。',
  'device-busy': '麦克风无法读取，可能正被其他程序占用或被系统限制。检查系统麦克风权限和设备后再试。',
  'microphone-unavailable': '当前浏览器没有提供麦克风授权接口。请在支持麦克风的普通浏览器中打开，或使用文字。',
  'permission-policy': '当前页面或浏览器策略禁止麦克风访问。请在普通浏览器直接打开此页面，并检查站点和系统麦克风权限。',
  'microphone-failed': '麦克风检查失败。请检查系统权限与输入设备，或使用文字继续。',
  network: '语音连接断开了。检查网络后，再点话筒继续。',
  'permission-timeout': '还没收到麦克风的回应。完成浏览器授权后，再点话筒继续。',
  'recognition-timeout': '麦克风已获准，但语音识别没有启动。请在支持识别的普通浏览器中重试，或使用文字。',
  'recognition-not-started': '语音识别在开始收音前结束了。请点击重试；如果反复出现，可换普通浏览器或使用文字。',
  'start-failed': '语音没能开始，再点一下话筒试试。',
  insecure: '语音需要安全连接。请使用 HTTPS，或在这台设备的 localhost / 127.0.0.1 打开；手机访问电脑的普通 HTTP 局域网地址通常不支持麦克风。',
  unsupported: '这个浏览器暂不支持语音识别，请在支持识别的普通浏览器中打开，打字也能一起逛。',
};

/** Explicit foreground conversation; recognition never overlaps narration. */
export function createVoiceSession({ store, guide, speech, scope = globalThis, onTranscript = () => {},
  schedule = setTimeout, unschedule = clearTimeout, cooldown = 650, continuous = false } = {}) {
  let enabled = false, disposed = false, running = false, executing = false;
  let generation = 0, wakeup = null, silentRounds = 0;
  let pendingPermission = false, backgrounded = false;
  const cancelWakeup = () => { unschedule(wakeup); wakeup = null; };
  const valid = token => enabled && !disposed && token === generation;

  function end({ message, error = null, errorCode = null, interrupt = true } = {}) {
    enabled = false; generation += 1; running = false; executing = false; pendingPermission = false; cancelWakeup();
    speech.stopRecognition();
    if (interrupt) guide.interrupt();
    onTranscript('');
    store.set({ voiceSession: false, guideStatus: 'idle', voiceCaptureStage: null, currentTranscript: '', guideError: error, voiceErrorCode: errorCode, ...(message ? { guideText: message } : {}) });
  }
  function queue() {
    if (!enabled || disposed || backgrounded || running || executing || BUSY.has(store.get().guideStatus)) { cancelWakeup(); return; }
    // Position updates must not keep postponing the same listening cooldown.
    if (wakeup !== null) return;
    const token = generation;
    wakeup = schedule(() => { wakeup = null; if (valid(token)) void listen(); }, cooldown);
  }
  async function run(action) {
    if (disposed) return { status: 'disposed' };
    cancelWakeup(); generation += 1;
    const token = generation;
    running = false; executing = true; speech.stopRecognition(); onTranscript('');
    try {
      const result = await action();
      if (valid(token) && (result?.intent === 'stop' || result?.status === 'error')) end();
      return result;
    } catch {
      if (token === generation) end({ message: '这次没接上，我们再试一次。', error: '本轮陪游已暂停。' });
      return { status: 'error' };
    } finally {
      if (token === generation) { executing = false; queue(); }
    }
  }
  async function listen({ requestPermission = false } = {}) {
    if (!enabled || disposed || backgrounded || running || executing || BUSY.has(store.get().guideStatus)) return;
    requestPermission = requestPermission || pendingPermission;
    pendingPermission = false;
    cancelWakeup(); running = true;
    const token = generation;
    store.set({ guideStatus: 'requesting', voiceCaptureStage: requestPermission ? 'permission' : 'recognition', guideError: null, voiceErrorCode: null, currentTranscript: '', ...(requestPermission ? { microphoneState: 'requesting' } : {}) });
    let result;
    try {
      if (requestPermission) {
        const permission = speech.requestMicrophone ? await speech.requestMicrophone() : { status: 'error', error: 'microphone-unavailable' };
        if (!valid(token)) return;
        if (permission.diagnostics) store.set({ microphoneDiagnostics: permission.diagnostics });
        if (permission.status !== 'granted') result = permission;
        else store.set({ microphoneState: 'granted', voiceCaptureStage: 'recognition' });
      }
      if (!result) result = await speech.recognizeOnce(text => {
        if (!valid(token)) return;
        store.set({ currentTranscript: text }); onTranscript(text);
      }, { onStart() {
        if (valid(token)) store.set({ guideStatus: 'listening', voiceCaptureStage: 'listening', microphoneState: 'granted' });
      } });
    } catch { result = { status: 'error', error: 'start-failed' }; }
    if (!valid(token)) return;
    running = false; onTranscript('');
    if (result.status === 'success' && result.audio && guide.submitAudio) {
      silentRounds = 0; store.set({ microphoneState: 'tested' });
      await run(() => guide.submitAudio(result.audio));
    } else if (result.status === 'success' && result.text?.trim()) {
      silentRounds = 0; store.set({ microphoneState: 'tested' });
      await run(() => guide.submit(result.text));
    } else if (result.status === 'empty') {
      silentRounds += 1;
      if (continuous) { store.set({ guideStatus: 'idle', currentTranscript: '' }); queue(); }
      else if (silentRounds >= 2) end({ message: '先安静陪你看看，想聊时再点话筒。' });
      else { store.set({ guideStatus: 'idle', guideText: '慢慢来，我在听。', currentTranscript: '' }); queue(); }
    } else {
      if (result.error === 'not-allowed') store.set({ microphoneState: 'denied' });
      else if (result.error === 'audio-capture') store.set({ microphoneState: 'missing' });
      else if (result.error === 'device-busy') store.set({ microphoneState: 'busy' });
      else if (result.error === 'permission-policy') store.set({ microphoneState: 'restricted' });
      else if (result.error === 'microphone-unavailable') store.set({ microphoneState: 'unavailable' });
      const message = ERRORS[result.error] ?? (result.status === 'cancelled' ? '好，先停一下。' : '这里暂时听不到声音，打字也能一起逛。');
      end({ message, error: result.status === 'cancelled' ? null : message, errorCode: result.status === 'cancelled' ? null : result.error ?? 'start-failed' });
    }
  }
  const unsubscribe = store.subscribe(state => {
    if (!enabled || disposed) return;
    if (state.guideError && state.guideStatus === 'idle') {
      end({ error: state.guideError, interrupt: false }); return;
    }
    queue();
  });
  return {
    get active() { return enabled; },
    /** Pass userInitiated:true only from a real visitor click/tap to request capture permission. */
    start({ userInitiated = false, opening = null } = {}) {
      if (disposed || enabled) return false;
      // An automatic retry cannot clear a saved browser denial. A real visitor
      // gesture may request once more and let the browser enforce its setting.
      if (!userInitiated && (store.get().microphoneState === 'denied' || ['not-allowed', 'recognition-not-allowed', 'service-not-allowed', 'permission-policy'].includes(store.get().voiceErrorCode))) return false;
      const caps = getBrowserCapabilities(scope);
      if (!caps.secureContext || !(speech.supportsRecognition?.() ?? caps.speechRecognition)) {
        const message = !caps.secureContext ? ERRORS.insecure : ERRORS.unsupported;
        end({ message, error: message, errorCode: !caps.secureContext ? 'insecure' : 'unsupported' });
        return false;
      }
      if (userInitiated) void speech.unlock?.();
      const staleErrorCaption = store.get().guideError && store.get().guideText === store.get().guideError;
      // A location action may still be settling while a paused session restarts.
      // Its old generation must not leave capture marked as executing forever.
      cancelWakeup(); executing = false; running = false;
      guide.interrupt(); generation += 1; enabled = true; silentRounds = 0;
      pendingPermission = userInitiated;
      store.set({ voiceSession: true, guideError: null, voiceErrorCode: null, ...(staleErrorCaption ? { guideText: '点一下地标，或说“带我看铁塔”。' } : {}) });
      if (opening) guide.announceMode(opening);
      void listen(); return true;
    },
    stop: end, run,
    setBackground(hidden) {
      backgrounded = Boolean(hidden);
      if (!backgrounded) { queue(); return; }
      cancelWakeup(); generation += 1; running = false; executing = false; pendingPermission = false;
      speech.stopRecognition(); onTranscript('');
      // Leave guide playback/status intact: backgrounding is not a stop request.
      if (['requesting', 'listening'].includes(store.get().guideStatus)) {
        store.set({ guideStatus: 'idle', voiceCaptureStage: null, currentTranscript: '' });
      }
    },
    interruptAndListen() {
      if (!enabled || disposed) return false;
      cancelWakeup(); generation += 1; executing = false; running = false;
      guide.interrupt();
      store.set({ guideStatus: 'idle' });
      void listen(); return true;
    },
    dispose() { if (disposed) return; end(); disposed = true; unsubscribe(); },
  };
}
