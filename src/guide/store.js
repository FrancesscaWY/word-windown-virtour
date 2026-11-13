const initialState = {
  view: 'map', selectedPoiId: 'eiffel', mentionedPoiId: null, tourMode: 'interactive', companionPaused: false,
  visitorOrigin: null, visitorOriginSource: '未获取位置',
  interactionInput: 'voice', voiceSession: false, speechCharIndex: null, guideStatus: 'idle', microphoneState: 'not-requested', currentTranscript: '',
  callState: 'idle', callId: null, callInput: 'off', callMuted: false, callStartedAt: null,
  detailsOpen: false, activeHotspotId: null,
  guideText: '点一下地标，或说“带我看铁塔”。',
  guideError: null, pendingNarration: null, visitInfo: null,
  recommendedPoiIds: [], clarification: null, mode: 'local-rules',
  lastIntent: null, facilityInfo: null, plannedRoute: null,
  sessionId: 0, messages: [], suggestions: [], narrationCue: null, proactiveSuppressed: false, preference: null,
  showConversationStarters: false,
};

export function createStore(seed = {}) {
  let state = { ...initialState, ...seed, messages: [...(seed.messages ?? [])], recommendedPoiIds: [...(seed.recommendedPoiIds ?? [])] };
  const listeners = new Set();
  return {
    get: () => state,
    set(patch) { state = { ...state, ...patch }; listeners.forEach((listener) => listener(state)); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

export const store = createStore();
