import { createRealtimeCall } from '../services/realtime-call.js';
import { createCallSounds } from '../services/call-sounds.js';
import { toolEffect } from './tool-effects.js';

/** Independent capture/playout states: speaking never means the mic is closed. */
export function createCallSession({ store, guide, scope = globalThis, createTransport = createRealtimeCall,
  sounds = createCallSounds({ scope }) } = {}) {
  let enabled = false, epoch = 0;
  const appliedTools = new Set();
  function message(id, role, text, patch = {}) {
    if (!text) return;
    const key = `call-${epoch}-${id}`;
    const messages = [...store.get().messages];
    const index = messages.findIndex(row => row.id === key);
    const row = { id: key, role, text, content: text, ...patch };
    if (index >= 0) messages[index] = row; else messages.push(row);
    store.set({ messages: messages.slice(-12) });
  }
  const transport = createTransport({ scope, onEvent(event) {
    if (!enabled) return;
    switch (event.type) {
      case 'ready':
        store.set({ callState: 'connected', callId: event.callId ?? null, callStartedAt: Date.now(), callInput: 'listening', guideStatus: 'listening',
          microphoneState: 'granted', voiceCaptureStage: 'listening', guideModel: event.model, guideText: '我在听，直接说就好。' });
        void sounds.play('connected'); break;
      case 'speech_started':
        store.set({ callInput: 'speaking', guideStatus: 'listening', currentTranscript: '', guideText: '我在听。' }); break;
      case 'speech_stopped':
        store.set({ callInput: 'listening', guideStatus: 'thinking' }); break;
      case 'transcript':
        store.set({ currentTranscript: event.text });
        message(event.itemId, 'user', event.text); break;
      case 'response_started': store.set({ guideStatus: 'thinking' }); break;
      case 'playback_started': store.set({ guideStatus: 'speaking' }); break;
      case 'playback_done': store.set({ guideStatus: event.continuing ? 'thinking' : 'listening' }); break;
      case 'answer':
        store.set({ guideText: event.text });
        message(event.responseId, 'assistant', event.text); break;
      case 'interrupted': {
        // Text deltas can run ahead of the speaker. Never seed a later session with unheard claims.
        const key = `call-${epoch}-${event.responseId}`;
        store.set({ guideStatus: 'listening', messages: store.get().messages.map(row => row.id === key
          ? { ...row, text: '（这段回答已被打断）', content: '（这段回答已被打断）', interrupted: true } : row) });
        break;
      }
      case 'tool_end': {
        if (appliedTools.has(event.trace?.id)) break;
        appliedTools.add(event.trace.id);
        const patch = toolEffect(event.trace);
        if (patch) store.set(patch);
        store.set({ guideTraces: [...(store.get().guideTraces ?? []).slice(-15), event.trace] });
        break;
      }
      case 'error':
        enabled = false;
        store.set({ callState: 'error', callInput: 'off', voiceSession: false, guideStatus: 'idle',
          guideError: event.message, voiceErrorCode: event.code, ...(event.code === 'not-allowed' ? { microphoneState: 'denied' } : {}) });
        void sounds.play('ended'); break;
    }
  } });
  return {
    get active() { return enabled; },
    start() {
      if (enabled) return;
      epoch++; appliedTools.clear();
      // Both audio contexts are unlocked inside the user's call-button tap.
      void sounds.play('dial');
      guide.interrupt(); enabled = true;
      store.set({ callState: 'connecting', callId: null, callStartedAt: null, callMuted: false, callInput: 'off', voiceSession: true,
        guideStatus: 'requesting', microphoneState: 'requesting', voiceCaptureStage: 'permission', guideError: null, voiceErrorCode: null,
        currentTranscript: '', guideTraces: [], mode: 'backend-native' });
      transport.start(store.get());
    },
    stop({ audible = true } = {}) {
      const hadCall = store.get().callState !== 'idle';
      transport.stop(); enabled = false;
      store.set({ callState: 'idle', callStartedAt: null, callMuted: false, callInput: 'off', voiceSession: false,
        guideStatus: 'idle', voiceCaptureStage: null, currentTranscript: '', guideError: null, voiceErrorCode: null });
      if (hadCall && audible) void sounds.play('ended'); else sounds.stop();
    },
    interrupt() { if (enabled) { transport.interrupt(); guide.interrupt(); store.set({ guideStatus: 'listening' }); } },
    toggleMute() {
      if (store.get().callState !== 'connected') return;
      const muted = !store.get().callMuted;
      transport.setMuted(muted); store.set({ callMuted: muted });
    },
    async run(action) {
      transport.interrupt();
      try { return await action(); }
      finally { if (enabled) { transport.updateContext(store.get()); store.set({ guideStatus: 'listening' }); } }
    },
    dispose() { enabled = false; transport.stop(); sounds.dispose(); },
  };
}
