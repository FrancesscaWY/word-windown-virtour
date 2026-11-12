import test from 'node:test';
import assert from 'node:assert/strict';
import { voicePresentation, shouldAutoStartVoice } from '../src/components/voice-status.js';
import { createStore } from '../src/guide/store.js';
import { experienceMarkup } from '../src/components/experience.js';
import { icon } from '../src/components/icons.js';

const state = patch => createStore(patch).get();

test('the listening affordance only represents confirmed microphone capture', () => {
  const stages = [
    [state(), { starting: true }, 'requesting'],
    [state({ voiceSession: true, guideStatus: 'requesting' }), {}, 'requesting'],
    [state({ voiceSession: true, guideStatus: 'listening' }), {}, 'listening'],
    [state({ voiceSession: true, guideStatus: 'idle' }), {}, 'waiting'],
    [state({ voiceSession: true, guideStatus: 'thinking' }), {}, 'processing'],
    [state({ voiceSession: true, guideStatus: 'waiting' }), {}, 'processing'],
    [state({ voiceSession: false, guideStatus: 'listening' }), {}, 'paused'],
  ];
  for (const [snapshot, options, expected] of stages) {
    const presentation = voicePresentation(snapshot, options);
    assert.equal(presentation.status, expected);
    assert.equal(presentation.listening, expected === 'listening');
    assert.equal(presentation.icon === 'listening', expected === 'listening');
    assert.equal(presentation.hint.includes('正在聆听'), expected === 'listening');
    assert.notEqual(presentation.icon, 'play');
  }
});

test('the voice control interrupts narration and pauses capture, with a microphone to resume', () => {
  for (const active of [true, false]) {
    for (const status of ['speaking', 'preparing']) {
      const presentation = voicePresentation(state({ guideStatus: status, voiceSession: active }));
      assert.equal(presentation.action, 'interrupt');
      assert.equal(presentation.label, '打断讲解');
      assert.match(presentation.hint, /点击打断/);
      assert.equal(presentation.icon, 'narrating');
      assert.equal(presentation.status, status);
      assert.equal(presentation.busy, status === 'preparing');
      assert.equal(presentation.listening, false);
    }
  }
  assert.equal(voicePresentation(state({ voiceSession: true, guideStatus: 'listening' })).action, 'pause');
  const paused = voicePresentation(state());
  assert.equal(paused.action, 'resume');
  assert.equal(paused.icon, 'mic-muted');
  assert.equal(paused.hint, '已暂停 · 点击继续');
});

test('failed authorization and unavailable recognition have distinct honest hints', () => {
  for (const [code, expected] of [
    ['not-allowed', /未授权/], ['audio-capture', /未找到麦克风/], ['network', /连接失败/],
    ['permission-timeout', /授权超时/], ['unsupported', /不支持语音/], ['insecure', /HTTPS/],
    ['recognition-not-allowed', /识别被拒绝/], ['service-not-allowed', /语音识别被禁用/],
    ['device-busy', /占用或系统限制/], ['permission-policy', /策略限制/],
    ['microphone-unavailable', /没有麦克风授权接口/], ['recognition-timeout', /识别启动超时/],
  ]) {
    const presentation = voicePresentation(state({ guideError: '失败', voiceErrorCode: code }), { starting: true });
    assert.equal(presentation.status, 'error');
    assert.equal(presentation.listening, false);
    assert.equal(presentation.action, 'resume');
    assert.match(presentation.hint, expected);
    assert.doesNotMatch(presentation.hint, /正在聆听/);
    assert.notEqual(presentation.icon, 'play');
  }
});

test('a scene failure pauses listening without blaming the microphone', () => {
  const sceneError = voicePresentation(state({ guideError: '画面暂时无法加载。', microphoneState: 'granted' }));
  assert.equal(sceneError.status, 'paused');
  assert.equal(sceneError.icon, 'mic-muted');
  assert.equal(sceneError.label, '继续聆听');
  assert.equal(sceneError.hint, '聆听已暂停 · 点击继续');
  assert.equal(sceneError.action, 'resume');
  assert.doesNotMatch(sceneError.hint, /麦克风|语音暂不可用/);

  const captureError = voicePresentation(state({ guideError: '没有找到可用的麦克风。', voiceErrorCode: 'audio-capture', microphoneState: 'granted' }));
  assert.equal(captureError.status, 'error');
  assert.match(captureError.hint, /未找到麦克风/);
  const denied = voicePresentation(state({ guideError: '画面暂时无法加载。', microphoneState: 'denied' }));
  assert.equal(denied.status, 'error');
  assert.match(denied.hint, /未授权/);
  const retry = voicePresentation(state({ guideStatus: 'requesting', voiceSession: true, microphoneState: 'denied' }));
  assert.equal(retry.status, 'requesting', 'retrying must show preparation after clearing the previous error');
  assert.match(retry.hint, /请允许权限/);
});

test('interactive voice and companion listen automatically; text, pauses and permissions remain respected', () => {
  const interactive = state();
  assert.equal(shouldAutoStartVoice(interactive), true);
  assert.equal(shouldAutoStartVoice(state({ tourMode:'companion' })), true);
  assert.equal(shouldAutoStartVoice(state({ tourMode:'companion', interactionInput:'text' })), true);
  assert.equal(shouldAutoStartVoice(state({ tourMode:'companion', companionPaused:true })), false);
  for (const patch of [{ tourMode: 'immersive' }, { interactionInput: 'text' }, { voiceSession: true }, { guideError: '请允许权限' }, { voiceErrorCode: 'not-allowed' }, { microphoneState: 'denied' }, { microphoneState: 'restricted' }]) assert.equal(shouldAutoStartVoice(state(patch)), false);
  for (const options of [{ paused: true }, { hidden: true }, { dialogOpen: true }]) assert.equal(shouldAutoStartVoice(interactive, options), false);
  assert.equal(shouldAutoStartVoice(state({ tourMode: 'interactive', interactionInput: 'voice' }), { paused: true }), false, 'mode changes must not override a visitor pause');
  assert.equal(shouldAutoStartVoice(interactive, { paused: false }), true);
});

test('real microphone permission and pending recognition both remain preparation states', () => {
  const permission = voicePresentation(state({ voiceSession: true, guideStatus: 'requesting', microphoneState: 'requesting', voiceCaptureStage: 'permission' }));
  assert.equal(permission.status, 'requesting');
  assert.match(permission.hint, /申请麦克风.*浏览器授权/);
  assert.equal(permission.listening, false);
  const recognition = voicePresentation(state({ voiceSession: true, guideStatus: 'requesting', microphoneState: 'granted', voiceCaptureStage: 'recognition' }));
  assert.equal(recognition.status, 'requesting');
  assert.match(recognition.hint, /启动语音识别/);
  assert.equal(recognition.listening, false);
  assert.doesNotMatch(recognition.hint, /正在聆听/);
});

test('companion permission denial always uses a muted microphone, including during actual narration', () => {
  for (const guideStatus of ['idle', 'speaking', 'preparing']) {
    const presentation = voicePresentation(state({ tourMode:'companion', microphoneState:'denied', guideStatus }));
    assert.equal(presentation.icon, 'mic-muted');
    assert.equal(presentation.listening, false);
    assert.match(presentation.hint, guideStatus === 'idle' ? /麦克风未授权/ : /讲解中/);
    assert.equal(presentation.action, guideStatus === 'idle' ? 'resume' : 'interrupt');
  }
});

test('initial UI offers combined text, voice, sound control and tap-to-call', () => {
  const markup = experienceMarkup();
  const button = /<button[^>]+id="speech-button"[^>]*>([\s\S]*?)<\/button>/.exec(markup);
  assert.ok(button);
  assert.match(button[0], /data-voice-state="paused"/);
  assert.match(button[0], /aria-describedby="voice-hint"/);
  assert.match(markup, /id="guide-voice-toggle"/);
  assert.match(markup, /id="live-call-button"/);
  assert.match(markup, /打字问我，或点话筒说一句/);
  assert.match(markup, /点一下进入通话/);
  assert.doesNotMatch(button[1], /m9 5 11 7-11 7Z/);
  assert.equal((icon('listening').match(/class="listening-bar"/g) ?? []).length, 5);
  assert.equal(icon('listening'), icon('listening'));
});
