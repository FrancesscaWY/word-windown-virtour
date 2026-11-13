export function callPresentation(state, now = Date.now()) {
  const elapsed = state.callStartedAt ? Math.max(0, Math.floor((now - state.callStartedAt) / 1000)) : 0;
  const duration = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  if (state.callState === 'error') return { label: '通话已断开', hint: state.guideError, duration: '', state: 'error' };
  if (state.callState === 'connecting') return { label: '正在接通沐沐…', hint: '首次通话请允许麦克风', duration: '', state: 'connecting' };
  if (state.callMuted) return { label: '麦克风已静音', hint: '你仍能听到沐沐的声音', duration, state: 'muted' };
  if (state.callInput === 'speaking') return { label: '我在听', hint: '慢慢说，不用按住按钮', duration, state: 'listening' };
  if (state.guideStatus === 'speaking') return { label: '沐沐正在说', hint: '随时开口，就能打断我', duration, state: 'speaking' };
  if (state.guideStatus === 'thinking') return { label: '沐沐在想', hint: '麦克风保持开启，可以继续说', duration, state: 'thinking' };
  return { label: '沐沐在听', hint: '直接说话 · 随时打断', duration, state: 'listening' };
}
