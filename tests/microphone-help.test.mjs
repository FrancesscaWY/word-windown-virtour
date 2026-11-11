import test from 'node:test';
import assert from 'node:assert/strict';
import { microphoneHelp } from '../src/components/microphone-help.js';

const browser = patch => ({ isSecureContext: true, SpeechRecognition() {}, navigator: { mediaDevices: { getUserMedia() {} } }, location: { protocol: 'http:', origin: 'http://localhost:5173' }, ...patch });
const check = (result, label) => result.checks.find(([name]) => name === label)?.[1];

test('localhost uses the browser secure-context verdict and never invents permission', () => {
  const result = microphoneHelp({ microphoneState: 'not-requested' }, browser());
  assert.equal(result.canRequest, true);
  assert.equal(result.origin, 'http://localhost:5173');
  assert.equal(check(result, '麦克风权限'), '尚未请求');
  assert.equal(check(result, '页面麦克风策略'), '未知（浏览器未提供）');
  assert.equal(microphoneHelp({}, browser({ isSecureContext: false })).canRequest, false);
});

test('policy blocks explain embedded restrictions and offer a normal browser', () => {
  for (const key of ['permissionsPolicy', 'featurePolicy']) {
    const result = microphoneHelp({ voiceErrorCode: 'not-allowed' }, browser({ document: { [key]: { allowsFeature(feature) { assert.equal(feature, 'microphone'); return false; } } } }));
    assert.equal(result.canRequest, false);
    assert.match(result.explanation, /嵌入容器/);
    assert.match(result.steps[0], /Chrome 或 Edge/);
    assert.equal(check(result, '页面麦克风策略'), '禁止');
    assert.doesNotMatch(check(result, '麦克风权限'), /已获准|已成功/);
  }
});

test('missing or unreadable policy is unknown and does not manufacture a block', () => {
  const result = microphoneHelp({}, browser({ document: { permissionsPolicy: { allowsFeature() { throw new Error('unavailable'); } } } }));
  assert.equal(result.canRequest, true);
  assert.match(check(result, '页面麦克风策略'), /未知/);
  const blocked = microphoneHelp({ voiceErrorCode: 'permission-policy' }, browser());
  assert.equal(blocked.canRequest, false);
  assert.match(check(blocked, '页面麦克风策略'), /本次请求/);
});

test('recognition denial, capture denial and network errors remain distinct', () => {
  const denied = microphoneHelp({ voiceErrorCode: 'not-allowed', microphoneState: 'denied' }, browser());
  assert.equal(check(denied, '麦克风权限'), '已拒绝');
  const recognition = microphoneHelp({ voiceErrorCode: 'recognition-not-allowed', microphoneState: 'granted' }, browser());
  assert.match(recognition.explanation, /采集已获准.*识别服务拒绝/);
  assert.match(microphoneHelp({ voiceErrorCode: 'network' }, browser()).explanation, /连接语音识别服务/);
  assert.match(microphoneHelp({ voiceErrorCode: 'device-busy' }, browser()).steps[0], /占用/);
});

test('requesting describes preparation even after a previous denied state', () => {
  const result = microphoneHelp({ voiceSession: true, guideStatus: 'requesting', microphoneState: 'denied' }, browser());
  assert.equal(result.title, '正在准备麦克风');
  assert.equal(check(result, '麦克风权限'), '正在请求，尚未确认');
  assert.match(result.explanation, /尚未确认/);
});

test('recognition startup keeps confirmed capture permission while waiting for the engine', () => {
  const result = microphoneHelp({ voiceSession: true, guideStatus: 'requesting', voiceCaptureStage: 'recognition', microphoneState: 'granted' }, browser());
  assert.equal(result.title, '正在启动语音识别');
  assert.equal(check(result, '麦克风权限'), '最近一次采集已获准');
  assert.match(result.explanation, /尚未进入聆听/);
});

test('capture and recognition startup failures retain their specific diagnostic labels', () => {
  for (const [code, microphoneState, expected] of [
    ['microphone-unavailable', 'unavailable', /采集接口/],
    ['microphone-failed', 'busy', /无法读取/],
    ['recognition-timeout', 'granted', /已获准/],
    ['recognition-not-started', 'tested', /已成功采集/],
    ['permission-policy', 'restricted', /页面策略限制/],
    ['audio-capture', 'missing', /没有可用输入设备/],
  ]) {
    const result = microphoneHelp({ voiceErrorCode: code, microphoneState }, browser());
    assert.doesNotMatch(check(result, '最近语音错误'), /未知/);
    assert.match(check(result, '麦克风权限'), expected);
  }
});

test('all required browser capabilities gate requesting', () => {
  for (const patch of [{ isSecureContext: false }, { SpeechRecognition: undefined }, { navigator: {} }]) {
    assert.equal(microphoneHelp({}, browser(patch)).canRequest, false);
  }
  const file = microphoneHelp({}, browser({ location: { protocol: 'file:', origin: 'null' } }));
  assert.equal(file.origin, 'file://');
  assert.match(file.steps[0], /localhost/);
});
