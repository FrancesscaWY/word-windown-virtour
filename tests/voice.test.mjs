import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpeechService } from '../src/services/speech.js';
import { createVoiceSession } from '../src/guide/voice-session.js';
import { createGuideController } from '../src/guide/controller.js';
import { createTourActions } from '../src/guide/tour-actions.js';
import { createStore } from '../src/guide/store.js';
import { captionParts } from '../src/components/captions.js';
import { voicePresentation } from '../src/components/voice-status.js';

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture(options = {}) {
  let id = 0, activeRecognition = null, activeUtterance = null;
  const timers = new Map(), recognitions = [], utterances = [], transcripts = [];
  const schedule = (callback, ms) => { timers.set(++id, { callback, ms }); return id; };
  const unschedule = key => timers.delete(key);
  const scope = {
    isSecureContext: true, setTimeout: schedule, clearTimeout: unschedule,
    SpeechRecognition: class {
      constructor() { recognitions.push(this); }
      start() { assert.equal(activeUtterance, null, 'no microphone while narration is audible'); activeRecognition = this; this.onstart?.(); }
      abort() { if (activeRecognition === this) activeRecognition = null; this.onend?.(); }
      stop() { this.abort(); }
    },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    speechSynthesis: {
      getVoices() { return [{ lang: 'en-US' }, { lang: 'zh-CN', name: '中文' }]; },
      cancel() { const item = activeUtterance; activeUtterance = null; item?.onerror?.({ error: 'canceled' }); },
      speak(item) { assert.equal(activeRecognition, null, 'recognition must stop before playback'); activeUtterance = item; utterances.push(item); },
    },
  };
  const speech = createSpeechService(scope), store = createStore();
  const guide = createGuideController({ store, actions: createTourActions(store), speech });
  const session = createVoiceSession({ store, guide, speech, scope, schedule, unschedule, onTranscript: text => transcripts.push(text), ...options });
  const final = async text => {
    const instance = recognitions.at(-1);
    instance.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] });
    await flush();
  };
  const finish = async () => { const item = activeUtterance; activeUtterance = null; item.onend(); await flush(); };
  const fire = async ms => {
    const found = [...timers].find(([, item]) => item.ms === ms);
    assert.ok(found, `expected a ${ms} ms timer`); timers.delete(found[0]); found[1].callback(); await flush();
  };
  return { scope, speech, store, guide, session, timers, recognitions, utterances, transcripts, final, finish, fire };
}

test('resuming while an inactive location action settles cannot strand continuous capture', async () => {
  const f = fixture({ continuous:true });
  f.store.set({ tourMode:'companion' });
  const arrival = f.session.run(() => f.guide.narrateLocation('eiffel'));
  assert.equal(f.session.start(), true);
  await arrival; await flush();
  assert.equal(f.store.get().voiceSession, true);
  assert.equal(f.store.get().guideStatus, 'listening');
  assert.equal(f.recognitions.length, 1);
  f.session.dispose();
});

test('frequent simulated position updates cannot postpone listening after a greeting or arrival', async () => {
  const f = fixture({ continuous:true });
  f.store.set({ tourMode:'companion' });
  f.session.start({ opening:'一起出发吧。' });
  await f.finish();
  const updatesKeepCooldown = () => {
    const pending = [...f.timers].find(([, item]) => item.ms === 650)?.[0];
    assert.ok(pending);
    for (let step = 0; step < 12; step++) {
      f.store.set({ visitorOrigin:{ latitude:22.5 + step * .00001, longitude:113.9 }, locationStatus:`模拟位置 ${step}` });
      assert.equal([...f.timers].find(([, item]) => item.ms === 650)?.[0], pending, 'unrelated updates must preserve the pending deadline');
    }
  };
  updatesKeepCooldown(); await f.fire(650);
  assert.equal(f.store.get().guideStatus, 'listening');
  await f.session.run(() => f.guide.narrateLocation('eiffel'));
  await f.finish(); updatesKeepCooldown(); await f.fire(650);
  assert.equal(f.store.get().guideStatus, 'listening');
  f.session.dispose();
});

test('mode greeting finishes before capture and companion arrival resumes the same continuous conversation', async () => {
  const f = fixture({ continuous:true });
  f.store.set({ tourMode:'companion' });
  assert.equal(f.session.start({ opening:'即将带您开启伴游旅程，提醒您带好耳机，我们现在出发' }), true);
  assert.equal(f.recognitions.length, 0, 'greeting must not feed back into recognition');
  assert.equal(f.utterances.length, 1);
  f.utterances[0].onstart();
  await f.finish(); await f.fire(650);
  assert.equal(f.store.get().guideStatus, 'listening');
  await f.session.run(() => f.guide.narrateLocation('eiffel'));
  assert.equal(f.session.active, true);
  assert.equal(f.store.get().view, 'map');
  assert.equal(f.utterances.length, 2);
  await f.finish(); await f.fire(650);
  assert.equal(f.store.get().guideStatus, 'listening');
  assert.equal(f.recognitions.length, 2);
  await f.final('介绍凯旋门');
  assert.equal(f.store.get().view, 'map');
  assert.equal(f.store.get().pendingNarration, null);
  assert.match(f.utterances.at(-1).text, /凯旋门/);
  f.session.dispose();
});

test('blocked greeting autoplay still allows recognition; changing to text cancels its late completion', async () => {
  const f = fixture({ continuous:true });
  f.session.start({ opening:'皇上您说，奴婢在听~' });
  f.utterances[0].onerror({ error:'not-allowed' });
  await flush(); await f.fire(650);
  assert.equal(f.store.get().guideError, null);
  assert.equal(f.store.get().guideStatus, 'listening');
  f.session.stop();
  f.session.start({ opening:'皇上您说，奴婢在听~' });
  const old = f.utterances.at(-1);
  f.session.stop(); f.store.set({ interactionInput:'text' });
  old.onend?.(); await flush();
  assert.equal(f.session.active, false);
  assert.equal(f.store.get().voiceSession, false);
  assert.equal([...f.timers.values()].some(item => item.ms === 650), false);
  f.session.dispose();
});

test('a real permission request survives the greeting delay and is discarded when the visitor pauses', async () => {
  const f = fixture({ continuous:true }); let requested = 0;
  f.speech.requestMicrophone = async () => { requested++; return { status:'granted' }; };
  f.session.start({ userInitiated:true, opening:'皇上您说，奴婢在听~' });
  assert.equal(requested, 0);
  await f.finish(); await f.fire(650);
  assert.equal(requested, 1);
  assert.equal(f.store.get().guideStatus, 'listening');
  f.session.stop();
  f.session.start({ userInitiated:true, opening:'皇上您说，奴婢在听~' });
  const old = f.utterances.at(-1); f.session.stop(); old.onend?.(); await flush();
  assert.equal(requested, 1);
  assert.equal(f.session.active, false);
  f.session.dispose();
});

test('voice tour opens a scene, waits for rendering, narrates and listens again with context', async () => {
  const f = fixture();
  assert.equal(f.session.start(), true);
  assert.equal(f.store.get().guideStatus, 'listening');
  await f.final('带我看铁塔');
  assert.equal(f.store.get().view, 'panorama');
  assert.equal(f.store.get().guideStatus, 'waiting');
  assert.equal(f.utterances.length, 0);
  f.guide.whenSceneReady('eiffel');
  assert.equal(f.store.get().guideStatus, 'preparing', 'mouth must not move before actual playback');
  f.utterances[0].onstart();
  assert.equal(f.store.get().guideStatus, 'speaking');
  assert.equal(f.utterances[0].voice.lang, 'zh-CN');
  f.utterances[0].onboundary({ charIndex: 5 });
  assert.equal(f.store.get().speechCharIndex, 5);
  assert.equal([...f.timers.values()].some(timer => timer.ms === 650), false);
  await f.finish(); await f.fire(650);
  assert.equal(f.recognitions.length, 2);
  await f.final('它远不远');
  assert.equal(f.store.get().visitInfo.id, 'eiffel');
  assert.equal(f.store.get().view, 'panorama');
  f.session.stop();
  assert.equal(f.store.get().voiceSession, false);
  assert.equal(f.timers.size, 0);
});

test('tap interruption starts a new listening round and ignores late playback events', async () => {
  const f = fixture(); f.session.start(); await f.final('凯旋门人多吗');
  const old = f.utterances[0]; old.onstart();
  assert.equal(f.session.interruptAndListen(), true);
  assert.equal(f.store.get().guideStatus, 'listening');
  old.onboundary({ charIndex: 18 }); old.onend(); await flush();
  assert.equal(f.store.get().guideStatus, 'listening');
  assert.equal(f.store.get().speechCharIndex, null);
  await f.final('结束陪游');
  assert.equal(f.session.active, false);
  assert.equal(f.store.get().voiceSession, false);
  assert.equal(f.timers.size, 0);
});

test('explicit stop settles capture before synchronous native end events and discards late words', async () => {
  const f = fixture(); f.session.start(); const old = f.recognitions[0];
  f.session.stop({ message: '暂停了' });
  old.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: '带我去金字塔' }], { isFinal: true })] });
  await flush();
  assert.equal(f.store.get().view, 'map');
  assert.equal(f.store.get().mentionedPoiId, null);
  assert.equal(f.store.get().guideText, '暂停了');
  assert.equal(f.timers.size, 0);
});

test('two silent rounds end the session instead of repeatedly reopening the microphone', async () => {
  const f = fixture(); f.session.start(); f.recognitions[0].onerror({ error: 'no-speech' });
  await flush(); await f.fire(650);
  f.recognitions[1].onerror({ error: 'no-speech' }); await flush();
  assert.equal(f.session.active, false);
  assert.equal(f.recognitions.length, 2);
  assert.match(f.store.get().guideText, /再点话筒/);
  assert.equal(f.timers.size, 0);
});

test('continuous listening survives silence without repeating captions and explicit stop cancels pending capture', async () => {
  const f = fixture({ continuous: true });
  f.session.start();
  const caption = f.store.get().guideText;
  const changedCaptions = [];
  const unsubscribe = f.store.subscribe(state => { if (state.guideText !== caption) changedCaptions.push(state.guideText); });
  for (let round = 0; round < 4; round++) {
    f.recognitions.at(-1).onerror({ error: 'no-speech' });
    await flush();
    assert.equal(f.session.active, true);
    assert.equal(f.store.get().voiceSession, true);
    assert.equal(f.store.get().guideStatus, 'idle');
    assert.equal(f.store.get().guideText, caption);
    if (round < 3) await f.fire(650);
  }
  assert.deepEqual(changedCaptions, []);
  const pending = [...f.timers.values()].find(timer => timer.ms === 650).callback;
  const previous = f.recognitions.at(-1);
  f.session.stop();
  pending();
  previous.onend();
  await flush();
  assert.equal(f.session.active, false);
  assert.equal(f.store.get().voiceSession, false);
  assert.equal(f.store.get().guideStatus, 'idle');
  assert.equal(f.recognitions.length, 4);
  assert.equal(f.timers.size, 0);
  unsubscribe();
});

test('continuous listening stops on permission, device and network errors without scheduling retries', async () => {
  for (const [error, hint] of [['not-allowed', /允许浏览器/], ['audio-capture', /麦克风/], ['network', /网络/]]) {
    const f = fixture({ continuous: true });
    f.session.start();
    f.recognitions[0].onerror({ error: 'no-speech' });
    await flush();
    await f.fire(650);
    f.recognitions[1].onerror({ error });
    await flush();
    assert.equal(f.session.active, false);
    assert.equal(f.store.get().voiceSession, false);
    assert.equal(f.recognitions.length, 2);
    assert.equal(f.timers.size, 0);
    assert.match(f.store.get().guideError, hint);
    if (error === 'not-allowed') assert.equal(f.store.get().microphoneState, 'denied');
  }
});

test('permission, device and network errors stop the tour with distinct recovery hints', async () => {
  for (const [error, hint] of [['not-allowed', /允许浏览器/], ['audio-capture', /麦克风/], ['network', /网络/]]) {
    const f = fixture(); f.session.start(); f.recognitions[0].onerror({ error }); await flush();
    assert.equal(f.session.active, false); assert.equal(f.timers.size, 0);
    assert.match(f.store.get().guideText, hint);
    if (error === 'not-allowed') assert.equal(f.store.get().microphoneState, 'denied');
  }
});

test('an insecure or unsupported browser never opens capture', () => {
  const f = fixture(); f.scope.isSecureContext = false;
  assert.equal(f.session.start(), false); assert.equal(f.recognitions.length, 0);
  assert.match(f.store.get().guideText, /HTTPS/);
  f.scope.isSecureContext = true; delete f.scope.SpeechRecognition;
  assert.equal(f.session.start(), false); assert.match(f.store.get().guideText, /不支持/);
});

test('playback failure or a missing end event leaves readable text and stops automatic capture', async () => {
  const f = fixture(); f.session.start(); await f.final('凯旋门人多吗');
  await f.fire(10000);
  assert.equal(f.session.active, false);
  assert.match(f.store.get().guideError, /文字讲解/);
  assert.match(f.store.get().guideText, /凯旋门/);
  assert.equal(f.timers.size, 0);
});

test('recognition timeout is bounded and a final result survives a missing native end event', async () => {
  const f = fixture(); f.session.start();
  f.recognitions[0].stop = () => {};
  await f.final('金字塔人多吗');
  await f.fire(1200);
  assert.equal(f.store.get().visitInfo.id, 'pyramid');
  assert.equal(f.utterances.length, 1);
  f.session.stop();
});

test('map interaction supersedes capture and scene failure cannot restart a stopped tour', async () => {
  const f = fixture(); f.session.start();
  await f.session.run(() => f.guide.openPoi('eiffel'));
  const old = f.recognitions[0];
  old.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: '金字塔' }], { isFinal: true })] });
  f.guide.whenSceneFailed('eiffel'); await flush();
  assert.equal(f.session.active, false);
  assert.equal(f.store.get().selectedPoiId, 'eiffel');
  assert.equal(f.guide.whenSceneReady('eiffel'), false);
  assert.equal(f.timers.size, 0);
});

test('full recognition result lists do not concatenate repeated final transcripts', async () => {
  const f = fixture(); let interim = '';
  const pending = f.speech.recognizeOnce(text => { interim = text; });
  const instance = f.recognitions[0]; instance.stop = () => {};
  const first = Object.assign([{ transcript: '带我' }], { isFinal: true });
  instance.onresult({ resultIndex: 0, results: [first, Object.assign([{ transcript: '看看' }], { isFinal: false })] });
  instance.onresult({ resultIndex: 1, results: [first, Object.assign([{ transcript: '看铁塔' }], { isFinal: true })] });
  instance.onend();
  assert.equal((await pending).text, '带我看铁塔'); assert.equal(interim, '带我看铁塔');
  f.session.dispose();
});

test('sentence captions follow real boundary indices and keep all text without boundary support', () => {
  const text = '看看铁塔。再看看花园！';
  assert.deepEqual(captionParts(text, null), { before: '', current: '', after: text });
  assert.deepEqual(captionParts(text, 5), { before: '看看铁塔。', current: '再看看花园！', after: '' });
  assert.deepEqual(captionParts(text, 1), { before: '', current: '看看铁塔。', after: '再看看花园！' });
});


test('permission waiting times out once without repeatedly requesting access', async () => {
  const f = fixture();
  f.scope.SpeechRecognition.prototype.start = function () {};
  f.session.start();
  assert.equal(f.store.get().guideStatus, 'requesting');
  assert.equal(voicePresentation(f.store.get()).listening, false);
  assert.equal(voicePresentation(f.store.get()).status, 'requesting');
  await f.fire(15000);
  assert.equal(f.session.active, false);
  assert.equal(f.recognitions.length, 1);
  assert.match(f.store.get().guideText, /完成浏览器授权/);
  assert.equal(f.store.get().voiceErrorCode, 'permission-timeout');
  assert.equal(voicePresentation(f.store.get()).status, 'error');
  assert.equal(f.timers.size, 0);
});

test('native capture start changes preparation into listening and a visitor pause ignores late starts', async () => {
  const f = fixture({ continuous: true });
  const caption = f.store.get().guideText;
  f.scope.SpeechRecognition.prototype.start = function () {};
  f.session.start();
  assert.equal(f.store.get().guideStatus, 'requesting');
  assert.equal(f.store.get().guideText, caption, 'capture preparation must not replace the guide caption');
  assert.doesNotMatch(f.store.get().guideText, /我在听/);
  assert.equal(voicePresentation(f.store.get()).icon, 'mic');
  const instance = f.recognitions[0];
  instance.onstart();
  assert.equal(f.store.get().guideStatus, 'listening');
  assert.equal(f.store.get().guideText, caption);
  assert.equal(voicePresentation(f.store.get()).icon, 'listening');
  f.session.stop();
  instance.onstart();
  await flush();
  assert.equal(f.session.active, false);
  assert.equal(voicePresentation(f.store.get()).status, 'paused');
  assert.equal(f.timers.size, 0);
});

test('a visitor gesture requests a real microphone, releases its stream, then waits for native recognition start', async () => {
  const f = fixture();
  const caption = f.store.get().guideText;
  let resolvePermission, requests = 0, stopped = 0;
  const track = { readyState: 'live', stop() { stopped++; this.readyState = 'ended'; } };
  f.scope.navigator = {
    permissions: { async query(descriptor) { assert.deepEqual(descriptor, { name: 'microphone' }); return { state: 'denied' }; } },
    mediaDevices: { getUserMedia(constraints) { requests++; assert.deepEqual(constraints, { audio: true, video: false }); return new Promise(resolve => { resolvePermission = resolve; }); } },
  };
  f.scope.SpeechRecognition.prototype.start = function () { assert.equal(stopped, 1, 'diagnostic capture must be released before native recognition'); };
  f.store.set({ microphoneState: 'denied', voiceErrorCode: 'not-allowed', guideError: '拒绝' });
  assert.equal(f.session.start(), false, 'an automatic start must not repeat a saved denial');
  assert.equal(f.session.start({ userInitiated: true }), true);
  assert.equal(requests, 1, 'query=denied must still defer the real request to the browser');
  assert.equal(f.recognitions.length, 0);
  assert.equal(f.store.get().voiceCaptureStage, 'permission');
  assert.equal(f.store.get().guideText, caption);
  assert.equal(voicePresentation(f.store.get()).listening, false);
  resolvePermission({ getTracks: () => [track], getAudioTracks: () => [track] });
  await flush();
  assert.equal(f.recognitions.length, 1);
  assert.equal(stopped, 1);
  assert.equal(f.store.get().microphoneState, 'granted');
  assert.equal(f.store.get().guideStatus, 'requesting', 'getUserMedia success is not recognition onstart');
  assert.equal(f.store.get().voiceCaptureStage, 'recognition');
  assert.equal(f.store.get().guideText, caption, 'permission success belongs in the status hint, not guide narration');
  assert.equal(f.speech.getMicrophoneDiagnostics().permissionQueryState, 'denied');
  assert.equal(f.speech.getMicrophoneDiagnostics().permissionState, 'granted');
  assert.equal(voicePresentation(f.store.get()).listening, false);
  f.recognitions[0].onstart();
  assert.equal(f.store.get().guideStatus, 'listening');
  assert.equal(f.store.get().guideText, caption);
  assert.equal(voicePresentation(f.store.get()).listening, true);
  f.session.dispose();
  assert.equal(f.timers.size, 0);
});

test('recovering permission clears a stale error caption before showing real listening', async () => {
  const f = fixture({ continuous: true });
  f.session.start();
  f.recognitions[0].onerror({ error: 'not-allowed' });
  await flush();
  assert.equal(f.store.get().guideText, f.store.get().guideError);
  f.scope.navigator = { mediaDevices: { getUserMedia() { return Promise.resolve({ getTracks: () => [{ stop() {} }] }); } } };
  f.session.start({ userInitiated: true });
  await flush();
  assert.equal(f.store.get().guideStatus, 'listening');
  assert.equal(f.store.get().guideText, '点一下地标，或说“带我看铁塔”。');
  assert.equal(f.store.get().guideError, null);
  f.session.dispose();
});

test('real permission failures distinguish site denial, missing device, occupied device and policy errors', async () => {
  for (const [name, code, microphoneState, hint] of [
    ['NotAllowedError', 'not-allowed', 'denied', /站点权限/],
    ['NotFoundError', 'audio-capture', 'missing', /没有找到/],
    ['NotReadableError', 'device-busy', 'busy', /占用|系统限制/],
    ['SecurityError', 'permission-policy', 'restricted', /策略禁止/],
  ]) {
    const f = fixture({ continuous: true }); let requests = 0;
    f.scope.navigator = { mediaDevices: { getUserMedia() { requests++; return Promise.reject(Object.assign(new Error(name), { name })); } } };
    assert.equal(f.session.start({ userInitiated: true }), true);
    await flush();
    assert.equal(requests, 1);
    assert.equal(f.recognitions.length, 0);
    assert.equal(f.session.active, false);
    assert.equal(f.store.get().microphoneState, microphoneState);
    assert.equal(f.store.get().voiceErrorCode, code);
    assert.match(f.store.get().guideError, hint);
    assert.equal(voicePresentation(f.store.get()).listening, false);
    assert.equal(f.timers.size, 0, 'a failed permission request must not schedule another prompt');
    f.session.dispose();
  }
});

test('microphone permission and recognition service refusal remain distinct', async () => {
  for (const [nativeError, expected] of [['not-allowed', 'recognition-not-allowed'], ['service-not-allowed', 'service-not-allowed']]) {
    const f = fixture({ continuous: true }); let stopped = 0;
    const track = { stop() { stopped++; } };
    f.scope.navigator = { mediaDevices: { async getUserMedia() { return { getTracks: () => [track], getAudioTracks: () => [track] }; } } };
    f.scope.SpeechRecognition.prototype.start = function () {};
    f.session.start({ userInitiated: true }); await flush();
    const native = f.recognitions[0]; native.onerror({ error: nativeError }); await flush();
    assert.equal(stopped, 1);
    assert.equal(f.store.get().microphoneState, 'granted');
    assert.equal(f.store.get().voiceErrorCode, expected);
    assert.match(f.store.get().guideError, /识别/);
    assert.equal(f.session.active, false);
    assert.equal(f.session.start(), false, 'service refusal cannot trigger an automatic restart');
    native.onstart();
    assert.equal(voicePresentation(f.store.get()).listening, false);
    assert.equal(f.timers.size, 0);
    f.session.dispose();
  }
});

test('pausing or timing out a permission prompt releases late streams without starting recognition', async () => {
  for (const reason of ['pause', 'timeout']) {
    const f = fixture(); let resolvePermission, stopped = 0;
    f.scope.navigator = { mediaDevices: { getUserMedia() { return new Promise(resolve => { resolvePermission = resolve; }); } } };
    f.session.start({ userInitiated: true });
    if (reason === 'pause') f.session.stop(); else await f.fire(20000);
    resolvePermission({ getTracks: () => [{ stop() { stopped++; } }] });
    await flush();
    assert.equal(stopped, 1);
    assert.equal(f.recognitions.length, 0);
    assert.equal(f.session.active, false);
    assert.equal(voicePresentation(f.store.get()).listening, false);
    assert.equal(f.store.get().voiceErrorCode, reason === 'timeout' ? 'permission-timeout' : null);
    assert.equal(f.timers.size, 0);
    f.session.dispose();
  }
});

test('the microphone preflight checks security, browser API and embedding policy without opening capture', async () => {
  for (const [patch, expected] of [
    [{ isSecureContext: false }, 'insecure'],
    [{ navigator: {} }, 'microphone-unavailable'],
    [{ document: { permissionsPolicy: { allowsFeature: () => false } } }, 'permission-policy'],
  ]) {
    const f = fixture(); let requests = 0;
    f.scope.navigator = { mediaDevices: { getUserMedia() { requests++; throw new Error('must not be reached'); } } };
    Object.assign(f.scope, patch);
    const result = await f.speech.requestMicrophone();
    assert.equal(result.error, expected);
    assert.equal(requests, 0);
    assert.equal(f.recognitions.length, 0);
    assert.equal(result.diagnostics.lastError, expected);
    f.session.dispose();
  }
});

test('a granted microphone cannot be mistaken for recognition that never started', async () => {
  const f = fixture({ continuous: true });
  f.scope.navigator = { permissions: { query() { return Promise.reject(new Error('not supported')); } }, mediaDevices: { async getUserMedia() { return { getTracks: () => [] }; } } };
  f.scope.SpeechRecognition.prototype.start = function () {};
  f.session.start({ userInitiated: true }); await flush();
  assert.equal(f.store.get().guideStatus, 'requesting');
  await f.fire(15000);
  assert.equal(f.store.get().voiceErrorCode, 'recognition-timeout');
  assert.equal(f.store.get().microphoneState, 'granted');
  assert.equal(voicePresentation(f.store.get()).listening, false);
  assert.equal(f.timers.size, 0);
  f.session.dispose();
});

test('automatic entry does not issue getUserMedia prompts and a pre-start end cannot create a retry loop', async () => {
  const f = fixture({ continuous: true }); let requests = 0;
  f.scope.navigator = { mediaDevices: { getUserMedia() { requests++; } } };
  f.scope.SpeechRecognition.prototype.start = function () {};
  f.session.start();
  assert.equal(requests, 0);
  f.recognitions[0].onend(); await flush();
  assert.equal(f.store.get().voiceErrorCode, 'recognition-not-started');
  assert.equal(f.session.active, false);
  assert.equal(f.recognitions.length, 1);
  assert.equal(f.timers.size, 0);
  assert.equal(voicePresentation(f.store.get()).listening, false);
  f.session.dispose();
});

test('speech events arriving after disposal cannot revive the guide or microphone', async () => {
  const f = fixture(); f.session.start(); await f.final('凯旋门人多吗');
  const item = f.utterances[0];
  f.session.dispose(); f.guide.dispose();
  item.onstart(); item.onboundary({ charIndex: 10 }); item.onend(); await flush();
  assert.equal(f.store.get().voiceSession, false);
  assert.equal(f.store.get().guideStatus, 'idle');
  assert.equal(f.timers.size, 0);
});


test('background companion keeps current narration and resumes capture only after returning to foreground', async () => {
  const f = fixture({ continuous:true });
  f.store.set({ tourMode:'companion' });
  f.session.start({ opening:'我们现在出发。' });
  const opening = f.utterances.at(-1); opening.onstart();
  f.session.setBackground(true);
  assert.equal(f.session.active, true);
  assert.equal(f.store.get().guideStatus, 'speaking');
  assert.equal(f.store.get().voiceSession, true);
  await f.finish();
  assert.equal(f.recognitions.length, 0);
  assert.equal([...f.timers.values()].some(timer => timer.ms === 650), false);
  await f.session.run(() => f.guide.narrateLocation('eiffel'));
  assert.match(f.utterances.at(-1).text, /你已来到/);
  f.utterances.at(-1).onstart(); await f.finish();
  assert.equal(f.recognitions.length, 0, 'GPS narration does not open background capture');
  f.session.setBackground(false); await f.fire(650);
  assert.equal(f.store.get().guideStatus, 'listening');
  assert.equal(f.recognitions.length, 1);
  f.session.setBackground(true);
  assert.equal(f.store.get().guideStatus, 'idle');
  assert.equal(f.session.active, true);
  f.session.setBackground(false); await f.fire(650);
  assert.equal(f.recognitions.length, 2);
  f.session.dispose();
});
