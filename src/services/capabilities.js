export function getBrowserCapabilities(scope = globalThis) {
  return {
    secureContext: Boolean(scope.isSecureContext),
    speechRecognition: Boolean(scope.SpeechRecognition || scope.webkitSpeechRecognition),
    speechSynthesis: Boolean((scope.AudioContext || scope.webkitAudioContext) && scope.fetch && scope.location?.protocol !== 'file:'),
    microphone: Boolean(scope.navigator?.mediaDevices?.getUserMedia),
    localPreview: scope.location?.protocol === 'file:',
  };
}

export async function getServiceStatus() {
  if (location.protocol === 'file:') return { mode: 'offline-preview', guide: 'unconfigured', deployment: 'local-file' };
  const response = await fetch('/api/status', { signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error('服务状态暂时无法读取');
  return response.json();
}
