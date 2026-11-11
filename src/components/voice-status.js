/** Present actual capture/playback state without implying that the microphone is open. */
export function voicePresentation(state, { starting = false } = {}) {
  const active = Boolean(state.voiceSession);
  const result = (status, symbol, label, hint, action, guideLabel) => ({ status, icon: symbol, label, hint, action, guideLabel, listening: status === 'listening', busy: ['requesting', 'preparing'].includes(status), pressed: active });
  if (state.tourMode === 'companion' && state.microphoneState === 'denied' && ['speaking', 'preparing'].includes(state.guideStatus)) {
    return result('error', 'mic-muted', '打断讲解', '讲解中 · 点击打断', 'interrupt', '麦克风未授权');
  }
  if (['speaking', 'preparing'].includes(state.guideStatus)) {
    return result(state.guideStatus, 'narrating', '打断讲解', state.guideStatus === 'preparing' ? '准备讲解 · 点击打断' : '正在讲解 · 点击打断', 'interrupt', state.guideStatus === 'preparing' ? '准备讲解' : '正在讲解');
  }
  if (state.guideError || state.voiceErrorCode || (state.microphoneState === 'denied' && !starting && state.guideStatus !== 'requesting')) {
    if (!state.voiceErrorCode && state.microphoneState !== 'denied') return result('paused', 'mic-muted', '继续聆听', '聆听已暂停 · 点击继续', 'resume', '聆听已暂停');
    const hints = {
      'permission-required': '点击麦克风开启后端语音',
      'audio-playback-blocked': '点击麦克风允许声音播放',
      'not-allowed': '麦克风未授权 · 点击重试',
      'recognition-not-allowed': '识别被拒绝 · 查看帮助',
      'service-not-allowed': '语音识别被禁用',
      'audio-capture': '未找到麦克风',
      'device-busy': '麦克风被占用或系统限制',
      'permission-policy': '页面策略限制麦克风',
      'microphone-unavailable': '没有麦克风授权接口',
      'microphone-failed': '麦克风检查失败',
      network: '语音连接失败 · 点击重试',
      'permission-timeout': '授权超时 · 点击重试',
      'recognition-timeout': '识别启动超时 · 点击重试',
      'recognition-not-started': '识别未启动 · 点击重试',
      'start-failed': '麦克风未启动 · 点击重试',
      insecure: '语音需要 HTTPS',
      unsupported: '此浏览器不支持语音',
    };
    return result('error', 'mic-muted', '重试聆听', hints[state.voiceErrorCode] ?? (state.microphoneState === 'denied' ? hints['not-allowed'] : '语音不可用 · 点击重试'), 'resume', '语音未开启');
  }
  if (starting || (active && state.guideStatus === 'requesting')) {
    const hint = state.voiceCaptureStage === 'permission' ? '申请麦克风 · 请在浏览器授权' : state.voiceCaptureStage === 'recognition' && ['granted', 'tested'].includes(state.microphoneState) ? '正在启动语音识别' : state.microphoneState === 'not-requested' || state.microphoneState === 'denied' ? '准备麦克风 · 请允许权限' : '正在准备麦克风…';
    return result('requesting', 'mic', '暂停聆听', hint, 'pause', '准备聆听');
  }
  if (active && state.guideStatus === 'listening') return result('listening', 'listening', '暂停聆听', state.voiceProvider === 'backend-native' ? '正在聆听 · 说完稍候自动发送' : '正在聆听 · 点击暂停', 'pause', '正在聆听');
  if (active && ['thinking', 'waiting'].includes(state.guideStatus)) {
    return result('processing', 'mic', '暂停聆听', state.guideStatus === 'thinking' ? '正在想一想 · 点击暂停' : '等待画面 · 点击暂停', 'pause', state.guideStatus === 'thinking' ? '想一想…' : '等画面就位');
  }
  if (active) return result('waiting', 'mic', '暂停聆听', '准备继续聆听 · 点击暂停', 'pause', '准备聆听');
  return result('paused', 'mic-muted', '继续聆听', '已暂停 · 点击继续', 'resume', '聆听已暂停');
}

/** Auto-start only on entering voice mode, and respect an explicit visitor pause. */
export function shouldAutoStartVoice(state, { paused = false, hidden = false, dialogOpen = false } = {}) {
  const voiceMode = state.tourMode === 'interactive' && state.interactionInput === 'voice' || state.tourMode === 'companion' && !state.companionPaused;
  return voiceMode && !state.voiceSession && !state.guideError && !state.voiceErrorCode && !['denied', 'restricted'].includes(state.microphoneState) && !paused && !hidden && !dialogOpen;
}
