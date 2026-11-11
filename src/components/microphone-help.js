import { getBrowserCapabilities } from '../services/capabilities.js';

/** Describe observed browser state without requesting permission or opening capture. */
export function microphoneHelp(state = {}, scope = globalThis) {
  const caps = getBrowserCapabilities(scope);
  const native = state.voiceProvider === 'backend-native';
  if (native) caps.speechRecognition = Boolean((scope.AudioContext || scope.webkitAudioContext) && caps.microphone);
  const location = scope.location;
  const origin = location?.protocol === 'file:' ? 'file://' : location?.origin || '未知地址';
  let policy;
  try {
    const document = scope.document;
    const rules = typeof document?.permissionsPolicy?.allowsFeature === 'function' ? document.permissionsPolicy : document?.featurePolicy;
    if (typeof rules?.allowsFeature === 'function') {
      const allowed = rules.allowsFeature('microphone');
      if (typeof allowed === 'boolean') policy = allowed;
    }
  } catch { /* Some embedded browsers do not expose the policy. */ }

  const code = state.voiceErrorCode;
  const policyBlocked = policy === false || code === 'permission-policy';
  const requesting = ['requesting', 'pending'].includes(state.microphoneState) || Boolean(state.voiceSession && state.guideStatus === 'requesting');
  const recognitionStarting = state.voiceCaptureStage === 'recognition' && requesting;
  const permissionPending = requesting && !recognitionStarting && !['granted', 'tested'].includes(state.microphoneState);
  const permission = permissionPending ? '正在请求，尚未确认' : ({
    'not-requested': '尚未请求', prompt: '等待用户授权', denied: '已拒绝',
    granted: '最近一次采集已获准', tested: '最近一次已成功采集',
    missing: '没有可用输入设备', busy: '设备无法读取', restricted: '页面策略限制', unavailable: '浏览器未提供采集接口',
  }[state.microphoneState] ?? (code === 'not-allowed' ? '本次请求被拒绝' : '未知'));
  const errors = {
    'permission-required': ['开启后端语音对话', '浏览器负责录音和播放，录音会发送到后端语音模型理解并生成回答。'],
    'audio-playback-blocked': ['需要允许音频播放', '请点击麦克风解锁音频播放后重试。'],
    'not-allowed': ['麦克风未获授权', '本次麦克风请求被拒绝，可能来自站点权限或系统隐私设置。'],
    'permission-policy': ['当前页面禁止麦克风', '页面或嵌入容器的权限策略阻止了麦克风，站点授权不能解除这项限制。'],
    'recognition-not-allowed': ['语音识别被拒绝', ['granted', 'tested'].includes(state.microphoneState) ? '麦克风采集已获准，但浏览器的语音识别服务拒绝启动。' : '浏览器的语音识别服务拒绝启动；这与麦克风采集权限是两个环节。'],
    'service-not-allowed': ['语音识别服务不可用', '当前浏览器或页面环境限制了语音识别服务。'],
    'microphone-unavailable': ['此页面无法访问麦克风', '当前浏览器没有提供麦克风采集接口。'],
    'microphone-failed': ['麦克风检查失败', '浏览器未能完成麦克风采集检查，请确认系统权限和输入设备。'],
    'recognition-timeout': ['语音识别启动超时', '麦克风采集已获准，但浏览器的语音识别服务未能及时启动。'],
    'recognition-not-started': ['语音识别未启动', '浏览器的识别服务在开始收音前结束，尚未进入聆听状态。'],
    network: ['语音识别连接失败', '浏览器未能连接语音识别服务；允许麦克风后仍可能发生网络错误。'],
    unsupported: ['此浏览器不支持语音识别', '当前页面缺少语音识别接口，可以使用 Chrome 或 Edge 打开。'],
    insecure: ['需要安全连接', '麦克风需要浏览器认可的安全上下文，请使用 HTTPS 或本机 localhost 地址。'],
    'audio-capture': ['没有可用的麦克风', '浏览器未能采集声音，请检查麦克风连接、输入设备和系统权限。'],
    'device-busy': ['麦克风暂时无法使用', '麦克风可能被其他应用占用，或设备未能启动。'],
    'microphone-busy': ['麦克风暂时无法使用', '麦克风可能被其他应用占用，或设备未能启动。'],
    NotReadableError: ['麦克风暂时无法使用', '设备未能读取，可能被其他应用占用或受到系统限制。'],
    'permission-timeout': ['仍在等待麦克风授权', '浏览器尚未完成授权，请检查地址栏附近的权限提示。'],
    'start-failed': ['麦克风未能启动', '浏览器未能开始采集，请检查权限和设备后重试。'],
  };
  let [title, explanation] = errors[code] ?? (state.microphoneState === 'denied' ? errors['not-allowed'] : ['麦克风使用帮助', '点击开启语音后，浏览器可能会询问麦克风权限。']);
  let steps = ['在地址栏的站点权限中允许麦克风，再回到页面重试。', '在系统隐私设置中允许当前浏览器使用麦克风，并检查输入设备。', '若仍失败，用最新版 Chrome 或 Edge 重新打开当前地址。'];

  if (caps.localPreview) {
    title = '请通过本地服务打开';
    explanation = '当前使用 file:// 文件地址，语音权限和识别服务可能受限。';
    steps = ['启动项目本地服务，打开它提供的 http://localhost 或 http://127.0.0.1 地址。', '在 Chrome 或 Edge 中打开该地址，并允许站点和系统麦克风权限。'];
  } else if (!caps.secureContext || code === 'insecure') {
    [title, explanation] = errors.insecure;
    steps = ['使用 HTTPS 地址；在运行服务的本机可使用 http://localhost 或 http://127.0.0.1。', '在 Chrome 或 Edge 中重新打开该地址，再允许麦克风权限。'];
  } else if (policyBlocked) {
    [title, explanation] = errors['permission-policy'];
    steps = ['将当前地址复制到正常的 Chrome 或 Edge 窗口打开，再允许麦克风。', '如果独立浏览器仍被阻止，需要页面维护者检查 Permissions-Policy 和嵌入页面的麦克风授权。'];
  } else if (!caps.speechRecognition || code === 'unsupported') {
    [title, explanation] = errors.unsupported;
    steps = ['用最新版 Chrome 或 Edge 重新打开当前地址。', '若浏览器仍不提供语音识别，可继续使用文字输入。'];
  } else if (!caps.microphone) {
    title = '此页面无法访问麦克风';
    explanation = '当前浏览器没有提供麦克风采集接口。';
    steps = ['用最新版 Chrome 或 Edge 重新打开当前地址。', '检查系统是否允许该浏览器使用麦克风。'];
  } else if (recognitionStarting && ['granted', 'tested'].includes(state.microphoneState)) {
    title = '正在启动语音识别';
    explanation = '麦克风采集已获准，正在等待浏览器识别服务确认启动；尚未进入聆听状态。';
    steps = ['稍候，页面会在浏览器确认识别启动后显示正在聆听。', '若启动超时，请在支持语音识别的 Chrome 或 Edge 中重试。'];
  } else if (requesting) {
    title = '正在准备麦克风';
    explanation = '浏览器尚未确认采集已启动，当前不代表麦克风已经开启。';
    steps = ['查看地址栏附近的权限提示，选择允许麦克风。', '完成授权后稍候；若一直没有回应，检查站点和系统权限后重试。'];
  } else if (code === 'network') {
    steps = ['检查网络后重试；浏览器语音识别服务可能需要联网。', '用最新版 Chrome 或 Edge 重新打开当前地址；仍无法连接时可使用文字输入。'];
  } else if (['recognition-not-allowed', 'service-not-allowed', 'recognition-timeout', 'recognition-not-started'].includes(code)) {
    steps = ['用最新版 Chrome 或 Edge 在正常浏览器窗口重新打开当前地址。', '检查站点和系统麦克风权限；若语音识别服务仍被限制，可使用文字输入。'];
  } else if (['device-busy', 'microphone-busy', 'NotReadableError', 'audio-capture'].includes(code)) {
    steps = ['检查并选中可用的麦克风，关闭可能占用它的录音或通话应用。', '确认系统允许当前浏览器使用麦克风，再重试。'];
  } else if (!code && ['granted', 'tested'].includes(state.microphoneState)) {
    title = '麦克风采集已通过';
    explanation = '最近一次采集已成功授权；当前是否正在聆听以页面状态为准。';
  }
  return {
    title, explanation, steps, origin,
    canRequest: caps.secureContext && caps.speechRecognition && caps.microphone && !policyBlocked,
    checks: [
      ['安全上下文', caps.secureContext ? '是（浏览器确认）' : '否'],
      ['语音识别接口', native ? caps.speechRecognition ? '后端 Qwen 原生语音（浏览器负责录音）' : '录音或音频接口不可用' : caps.speechRecognition ? '可用' : '不支持'],
      ['麦克风采集接口', caps.microphone ? '可用' : '不可用'],
      ['页面麦克风策略', policy === false ? '禁止' : code === 'permission-policy' ? '本次请求被页面策略阻止' : policy === true ? '允许请求' : '未知（浏览器未提供）'],
      ['麦克风权限', permission],
      ['最近语音错误', code ? errors[code]?.[0] ?? '未知错误' : '无'],
    ],
  };
}
