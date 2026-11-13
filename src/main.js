import { getPoi, panoramaHotspots } from './data/pois.js';
import { facilities } from './data/facilities.js';
import { catalogResults } from './components/catalog.js';
import { icon } from './components/icons.js';
import { experienceMarkup } from './components/experience.js';
import { mountMap } from './components/map.js';
import { mountPanorama } from './components/panorama.js';
import { mountViewport } from './components/viewport.js';
import { store } from './guide/store.js';
import { createTourActions } from './guide/tour-actions.js';
import { createGuideController } from './guide/controller.js';
import { createVoiceSession } from './guide/voice-session.js';
import { captionParts } from './components/captions.js';
import { createSpeechService } from './services/speech.js';
import { createNativeVoiceService } from './services/native-voice.js';
import { createGuideResolver } from './services/guide.js';
import { getServiceStatus } from './services/capabilities.js';
import { mountSimulator } from './components/location-simulator.js';
import { createArrivalTracker, toMapPosition, nearestPoi } from './guide/location.js';
import { mountWorkspaceResize } from './components/workspace-resize.js';
import { mountCompanionDemo } from './components/companion-demo.js';
import { voicePresentation, shouldAutoStartVoice } from './components/voice-status.js';
import { microphoneHelp } from './components/microphone-help.js';
import { mountModeWorkspace, INTERACTIVE_GREETING, COMPANION_GREETING } from './components/mode-workspace.js';

const app = document.querySelector('#app');
app.innerHTML = experienceMarkup();
const $ = selector => document.querySelector(selector);
const browserSpeech = createSpeechService();
const speech = location.protocol === 'file:' ? browserSpeech : createNativeVoiceService({ browserSpeech });
store.set({ voiceProvider: speech.provider ?? 'browser' });
const actions = createTourActions(store);
const guide = createGuideController({ store, actions, speech, resolveIntent: createGuideResolver() });
const canvas = $('#panorama-canvas');
const hotspotLayer = $('#panorama-hotspots');
const voiceInput = $('#voice-input');
const inputToggle = document.createElement('button');
inputToggle.type = 'button';
inputToggle.className = 'icon-button input-toggle';
inputToggle.setAttribute('aria-controls', 'voice-input');
$('#voice-form').append(inputToggle);
const about = $('#about-sheet');
const microphoneSheet = $('#microphone-sheet');
const assetUrl = path => new URL(path, document.baseURI).href;
let panorama = null;
let panoramaGeneration = 0;
let photoTimeout = null;
let photoStatus = null;
let lastInteraction = Date.now();
let dictatedText = '';
let lastSpeechIcon = '';
let voiceManuallyPaused = false;
let automaticVoiceStartPending = true;
let automaticVoiceStartVersion = 0;
const announcedModes = new Set();
let enteringCompanion = false;
let pendingInitialArrival = false;
const voiceSession = createVoiceSession({ store, guide, speech, continuous: true, onTranscript(text) {
  if (text || voiceInput.value === dictatedText) { voiceInput.value = text; updateInput(); }
  dictatedText = text;
} });
let previous = {};
let locationWatch = null;
let locationGeneration = 0;
const simulatorPanel = document.createElement('section');
simulatorPanel.className = 'location-simulator';
simulatorPanel.setAttribute('aria-label', '伴游控制');
simulatorPanel.hidden = true;
$('.voice-dock').prepend(simulatorPanel);
const visitorMarker = document.createElement('div');
visitorMarker.className = 'visitor-marker'; visitorMarker.hidden = true;
visitorMarker.setAttribute('aria-label', '当前位置');
visitorMarker.innerHTML = '<span></span>';
$('.map-art').append(visitorMarker);
const arrival = createArrivalTracker(poi => {
  if (store.get().tourMode !== 'companion' || store.get().companionPaused) return;
  void voiceSession.run(() => guide.narrateLocation(poi.id));
});
function receiveLocation(position, source) {
  if (store.get().tourMode !== 'companion') return;
  store.set({ visitorOrigin: position, visitorOriginSource: source });
  const point = toMapPosition(position);
  const onMap = point.x >= 0 && point.x <= 100 && point.y >= 0 && point.y <= 100;
  visitorMarker.hidden = !onMap;
  visitorMarker.style.left = `${point.x}%`; visitorMarker.style.top = `${point.y}%`;
  const nearest = store.get().companionPaused || enteringCompanion ? nearestPoi(position) : arrival.update(position);
  locationStatus.textContent = nearest ? `${source} · ${nearest.poi.name} ${Math.round(nearest.distance)} 米` : source;
  locationStatus.title = `${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)}`;
  store.set({ locationStatus:locationStatus.textContent });
}
function toggleCompanion() {
  const paused = !store.get().companionPaused;
  cancelInput();
  store.set({ companionPaused: paused });
  arrival.reset();
  if (!paused) {
    voiceManuallyPaused = false;
    scheduleAutomaticListening();
    if (store.get().visitorOrigin) arrival.update(store.get().visitorOrigin);
  }
}
const simulator = mountSimulator({ container: simulatorPanel, onPosition: receiveLocation, onToggleCompanion: toggleCompanion, onSource(source) {
  guide.interrupt();
  stopLocation(); arrival.reset(); visitorMarker.hidden = true;
  store.set({ visitorOrigin: null, visitorOriginSource: source === 'simulated' ? '模拟定位' : '手机定位' });
  if (source === 'device') startLocation();
} });
const locationStatus = simulatorPanel.querySelector('.location-readout');
function stopLocation() {
  locationGeneration += 1;
  if (locationWatch !== null) navigator.geolocation?.clearWatch(locationWatch);
  locationWatch = null;
}
function startLocation() {
  stopLocation();
  const generation = locationGeneration;
  locationStatus.textContent = '正在定位…';
  store.set({ locationStatus:locationStatus.textContent });
  if (!navigator.geolocation) { locationStatus.textContent = '设备不支持定位'; store.set({ locationStatus:locationStatus.textContent }); return; }
  try { locationWatch = navigator.geolocation.watchPosition(position => {
    if (store.get().tourMode !== 'companion' || generation !== locationGeneration) return;
    const { latitude, longitude, accuracy } = position.coords;
    receiveLocation({ latitude, longitude, accuracy }, '手机定位');
  }, error => {
    if (store.get().tourMode !== 'companion' || generation !== locationGeneration) return;
    locationStatus.textContent = error.code === 1 ? '定位未获授权，请重新定位' : '暂时无法定位，请重新定位';
    store.set({ locationStatus:locationStatus.textContent });
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }); }
  catch {
    locationStatus.textContent = '定位不可用，请检查站点权限';
    store.set({ locationStatus:locationStatus.textContent });
  }
}
function closeModeMenu() {
  $('#mode-menu').hidden = true;
  $('#mode-button').setAttribute('aria-expanded', 'false');
}
$('#mode-button').addEventListener('click', () => {
  const open = $('#mode-menu').hidden;
  $('#mode-menu').hidden = !open;
  $('#mode-button').setAttribute('aria-expanded', String(open));
});
$('#mode-menu').addEventListener('click', event => {
  const button = event.target.closest('[data-tour-mode]');
  if (!button) return;
  const mode = button.dataset.tourMode;
  closeModeMenu();
  $('#mode-button').focus();
  if (mode === store.get().tourMode) return;
  cancelAutomaticListening();
  voiceSession.stop();
  guide.interrupt();
  stopLocation();
  simulator.setActive(false); arrival.reset(); visitorMarker.hidden = true;
  voiceInput.value = ''; updateInput();
  store.set({ tourMode: mode, companionPaused: false, detailsOpen: false, visitInfo: null, visitorOrigin: null, visitorOriginSource: '未获取位置' });
  pendingInitialArrival = mode === 'companion';
  if (mode === 'companion') {
    enteringCompanion = true;
    guide.showMap(); simulator.setActive(true);
    enteringCompanion = false;
    voiceManuallyPaused = false; scheduleAutomaticListening();
  }
  else if (mode === 'interactive') scheduleAutomaticListening();
});
document.addEventListener('click', event => { if (!event.target.closest('.mode-switch')) closeModeMenu(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('#mode-menu').hidden) { closeModeMenu(); $('#mode-button').focus(); }
});

const disposeViewport = mountViewport(app, window);
const disposeMap = mountMap($('.map-viewport'), {
  onFacility: id => { const item = facilities.find(f => f.id === id); if (item) void voiceSession.run(() => guide.showFacilities(item.kind, id)); },
  onFacilityKind: kind => { void voiceSession.run(() => {
    if (kind === 'all') { guide.showMap(); disposeMap.revealScenery(); }
    else guide.showFacilities(kind);
  }); },
  onDismissFacilities: () => { void voiceSession.run(() => { guide.interrupt(); store.set({facilityInfo:null}); }); },
  onSelect: id => { void voiceSession.run(() => guide.openPoi(id)); },
});

function voiceStatus(text) { $('#voice-status').textContent = text; }
function renderMicrophoneHelp(state) {
  const help = microphoneHelp(state);
  $('#microphone-title').textContent = help.title;
  $('#microphone-explanation').textContent = help.explanation;
  $('#microphone-checks').replaceChildren(...help.checks.map(([label, value]) => {
    const item = document.createElement('div');
    const term = document.createElement('dt'); term.textContent = label;
    const detail = document.createElement('dd'); detail.textContent = value;
    item.append(term, detail); return item;
  }));
  $('#microphone-steps').replaceChildren(...help.steps.map(text => {
    const item = document.createElement('li'); item.textContent = text; return item;
  }));
  $('#microphone-address').value = location.href;
  $('#enable-microphone').disabled = !help.canRequest;
}
function cancelAutomaticListening() { automaticVoiceStartPending = false; automaticVoiceStartVersion += 1; }
function cancelInput() { cancelAutomaticListening(); voiceSession.stop(); }
function startVoiceSession(options = {}) {
  if (options.userInitiated) void speech.unlock?.();
  const mode = store.get().tourMode;
  const opening = announcedModes.has(mode) ? null : mode === 'companion' ? COMPANION_GREETING : INTERACTIVE_GREETING;
  const started = voiceSession.start({ ...options, opening });
  if (started) announcedModes.add(mode);
  return started;
}
function scheduleAutomaticListening() {
  const options = () => ({ paused: voiceManuallyPaused, hidden: document.hidden, dialogOpen: !!document.querySelector('dialog[open]') });
  const token = ++automaticVoiceStartVersion;
  automaticVoiceStartPending = shouldAutoStartVoice(store.get(), options());
  if (!automaticVoiceStartPending) { render(store.get()); return; }
  render(store.get());
  queueMicrotask(() => {
    if (token !== automaticVoiceStartVersion) return;
    automaticVoiceStartPending = false;
    if (shouldAutoStartVoice(store.get(), options())) startVoiceSession();
    else render(store.get());
  });
}
function updateInput() {
  const state = store.get();
  const textInput = state.tourMode === 'immersive' || state.tourMode === 'interactive' && state.interactionInput === 'text';
  $('#send-button').hidden = !textInput || !voiceInput.value.trim();
}
function disposePanorama() { panoramaGeneration += 1; clearTimeout(photoTimeout); panorama?.(); panorama = null; hotspotLayer.replaceChildren(); }
function focusScene() { (store.get().view === 'panorama' ? canvas : store.get().view === 'photo' ? $('#photo-scene') : $('.map-viewport')).focus({ preventScroll: true }); }

function updateHotspots() {
  if (!panorama) return;
  const view = panorama.getView();
  const points = panoramaHotspots[store.get().selectedPoiId] ?? [];
  for (const button of hotspotLayer.querySelectorAll('[data-hotspot]')) {
    const point = points.find(item => item.id === button.dataset.hotspot);
    const projected = point ? panorama.projectHotspot(point) : { visible: false };
    const focused = document.activeElement === button;
    button.hidden = !view.ready || !projected.visible;
    if (button.hidden && focused) canvas.focus({ preventScroll: true });
    if (!button.hidden) { button.style.left = `${projected.x}px`; button.style.top = `${projected.y}px`; }
  }
}

function startPanorama(poi) {
  disposePanorama();
  const token = panoramaGeneration;
  const source = poi.panorama?.kind === 'cubemap'
    ? { ...poi.panorama, faces: poi.panorama.faces.map(assetUrl) }
    : assetUrl(poi.panorama);
  hotspotLayer.innerHTML = (panoramaHotspots[poi.id] ?? []).map(point => `<button type="button" class="panorama-hotspot" data-hotspot="${point.id}" aria-label="${point.title}" hidden><span aria-hidden="true">+</span>${point.title}</button>`).join('');
  panorama = mountPanorama(canvas, source, status => {
    if (token !== panoramaGeneration) return;
    const failed = status === 'error' || status === 'unsupported';
    $('#panorama-status').hidden = status === 'ready';
    $('#panorama-status').dataset.failed = String(failed);
    $('#retry-panorama').hidden = !failed;
    $('.scene-controls').hidden = status !== 'ready';
    canvas.setAttribute('aria-busy', String(status !== 'ready'));
    $('#panorama-status-text').textContent = failed ? '这段风景没加载出来，再试一次？' : '风景正在靠近…';
    if (status === 'ready') guide.whenSceneReady(poi.id);
    else if (failed) {
      guide.whenSceneFailed(poi.id);
      if ($('#panorama-scene').contains(document.activeElement)) $('#retry-panorama').focus({ preventScroll: true });
    }
    updateHotspots();
  });
  panorama.setOnViewChange(updateHotspots);
}

function startPhoto(poi) {
  disposePanorama();
  const token = panoramaGeneration;
  const photo = $('#scene-photo');
  photoStatus = 'loading'; photo.hidden = true;
  $('#photo-status').hidden = false; $('#photo-status').textContent = '风景正在靠近…';
  $('#retry-photo').hidden = true;
  $('#photo-label').textContent = poi.photo.label;
  const credit = $('#photo-credit');
  credit.replaceChildren();
  credit.title = `${poi.photo.capturedAt ?? ''} · ${poi.photo.changes ?? ''}`;
  for (const [text, href] of [[poi.photo.attribution, poi.photo.source], [poi.photo.license, poi.photo.licenseUrl]]) {
    const link = document.createElement('a'); link.textContent = text; link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    if (credit.childNodes.length) credit.append(' · '); credit.append(link);
  }
  photo.alt = `${poi.name} · ${poi.photo.label}`;
  const done = success => {
    if (token !== panoramaGeneration || photoStatus !== 'loading') return;
    clearTimeout(photoTimeout); photoStatus = success ? 'ready' : 'error';
    photo.hidden = !success; $('#photo-status').hidden = success;
    $('#retry-photo').hidden = success;
    if (success) guide.whenSceneReady(poi.id);
    else { $('#photo-status').textContent = '这张照片暂时没加载出来'; guide.whenSceneFailed(poi.id); }
  };
  photo.onload = () => done(photo.naturalWidth > 0);
  photo.onerror = () => done(false);
  photoTimeout = setTimeout(() => done(false), 15000);
  photo.src = assetUrl(poi.photo.file);
  if (photo.complete) queueMicrotask(() => done(photo.naturalWidth > 0));
}

function renderVisitInfo(info) {
  const card = $('#visit-card');
  card.hidden = !info;
  if (!info) return;
  $('#visit-title').textContent = getPoi(info.id)?.name ?? '游览信息';
  const facts = [['所在区域', info.region], ['步行距离', '尚未定位'], ['人流 / 排队', '暂无实时数据']];
  $('#visit-facts').replaceChildren(...facts.map(([label, value]) => {
    const item = document.createElement('div');
    const dt = document.createElement('dt'); dt.textContent = label;
    const dd = document.createElement('dd'); dd.textContent = value;
    item.append(dt, dd); return item;
  }));
}

function render(state) {
  app.dataset.tourMode = state.tourMode;
  app.dataset.inputMode = state.interactionInput;
  const immersive = state.tourMode === 'immersive';
  const companion = state.tourMode === 'companion';
  const textInput = immersive || (state.tourMode === 'interactive' && state.interactionInput === 'text');
  inputToggle.hidden = state.tourMode !== 'interactive';
  const inputIcon = textInput ? 'mic' : 'keyboard';
  if (inputToggle.dataset.icon !== inputIcon) { inputToggle.innerHTML = icon(inputIcon); inputToggle.dataset.icon = inputIcon; }
  inputToggle.title = textInput ? '切换语音交流' : '切换文字交流';
  inputToggle.setAttribute('aria-label', inputToggle.title);
  if (state.companionPaused !== previous.companionPaused) simulator.setPaused(state.companionPaused);
  voiceInput.hidden = !textInput;
  app.dataset.guideError = String(Boolean(state.guideError));
  $('#speech-button').hidden = textInput;
  if (state.tourMode !== previous.tourMode) {
    const symbols = { interactive: 'mic', immersive: 'panorama', companion: 'pin' };
    const labels = { interactive: '交互模式', immersive: '沉浸模式', companion: '伴游模式' };
    $('#mode-button').innerHTML = `${icon(symbols[state.tourMode])}<span class="mode-label">${labels[state.tourMode].replace('模式', '')}</span>${icon('down', 'mode-chevron')}`;
    $('#mode-button').title = `切换模式：${labels[state.tourMode]}`;
    $('#mode-button').setAttribute('aria-label', $('#mode-button').title);
    for (const button of document.querySelectorAll('[data-tour-mode]')) button.setAttribute('aria-pressed', String(button.dataset.tourMode === state.tourMode));
  }
  const before = previous;
  // Commit the snapshot before mounting a scene; status callbacks can synchronously update the store.
  previous = { ...state };
  const poi = getPoi(state.selectedPoiId);
  const inPanorama = state.view === 'panorama';
  const inScene = state.view !== 'map';
  const sceneChanged = before.view !== state.view || before.selectedPoiId !== state.selectedPoiId;
  const retryRequested = inScene && state.pendingNarration && state.pendingNarration.token !== before.pendingNarration?.token && ['error', 'unsupported'].includes(inPanorama ? panorama?.getView().status : photoStatus);

  if (sceneChanged) {
    if (!inPanorama) disposePanorama();
    $('#map-scene').hidden = inScene;
    $('#photo-scene').hidden = state.view !== 'photo';
    $('#panorama-scene').hidden = !inPanorama;
    $('#back-map').hidden = !inScene;
    $('#wordmark').hidden = inScene;
    $('#place-title').textContent = inScene ? poi.name : '世界之窗';
    $('#place-subtitle').textContent = inScene ? (inPanorama ? (poi.panoramaKind === 'cubemap' ? '实景全景 · 拖动环顾' : '环顾四周，发现故事') : '深圳园区 · 实拍照片') : '深圳';
    $('.scene-disclaimer').textContent = poi.panoramaLabel ?? '全景体验素材';
    if (before.view !== undefined && before.view !== state.view) focusScene();
  }
  for (const button of document.querySelectorAll('button[data-poi]')) {
    const selected = (state.mentionedPoiId ?? null) === button.dataset.poi;
    button.classList.toggle('selected', selected);
    button.classList.toggle('recommended', (state.recommendedPoiIds ?? []).includes(button.dataset.poi));
    button.setAttribute('aria-pressed', String(selected));
  }
  disposeMap.refresh?.();
  if (state.view === 'map' && state.recommendedPoiIds?.[0] && state.recommendedPoiIds[0] !== before.recommendedPoiIds?.[0]) disposeMap.focusPoi(state.recommendedPoiIds[0]);
  if (before.facilityInfo !== state.facilityInfo) {
    const info = state.facilityInfo;
    disposeMap.showFacilities(info);
    if (info) {
      const located = info.items.filter(item => item.position);
      if (located.length) disposeMap.focusFacilities(located.map(item => item.id));
    }
  }

  if (before.visitInfo !== state.visitInfo) renderVisitInfo(state.visitInfo);
  const speaking = state.guideStatus === 'speaking';
  const preparing = state.guideStatus === 'preparing';
  const voice = voicePresentation(state, { starting: automaticVoiceStartPending });
  const showVoiceHint = !textInput;
  const statusLabels = { requesting: '等话筒准备好', listening: '在听呢', thinking: '想一想…', waiting: '等风景就位', preparing: '准备开口', speaking: '慢慢讲给你听' };
  $('#guide-presence').dataset.state = state.guideStatus;
  $('#guide-presence').dataset.voiceState = voice.status;
  $('#guide-state-label').textContent = showVoiceHint ? voice.guideLabel : companion && state.companionPaused ? '伴游已暂停' : state.guideError ? '文字也陪你逛' : statusLabels[state.guideStatus] ?? (state.voiceSession ? '接着聊' : '陪你走走');
  const hint = $('#voice-hint');
  hint.hidden = !showVoiceHint;
  hint.parentElement.hidden = !showVoiceHint;
  hint.dataset.voiceState = voice.status;
  if (hint.textContent !== voice.hint) hint.textContent = voice.hint;
  $('#microphone-help').hidden = !showVoiceHint || voice.status !== 'error';
  const showingMicrophoneError = state.guideError && state.guideText === state.guideError && (state.voiceErrorCode || state.microphoneState === 'denied');
  // Keep guide content, while avoiding a second copy of microphone status text.
  $('#guide-caption').hidden = Boolean(showVoiceHint && (showingMicrophoneError || state.guideStatus === 'requesting'));
  $('#guide-suggestions').hidden = Boolean(showVoiceHint && showingMicrophoneError);
  if (microphoneSheet.open) renderMicrophoneHelp(state);
  if (state.guideText !== before.guideText || state.speechCharIndex !== before.speechCharIndex || speaking !== (before.guideStatus === 'speaking')) {
    const text = state.guideText || '点一下地标，或说“带我看铁塔”。';
    const parts = captionParts(text, speaking ? state.speechCharIndex : null);
    const caption = $('#guide-caption');
    if (parts.current) {
      const mark = document.createElement('mark'); mark.textContent = parts.current;
      caption.replaceChildren(document.createTextNode(parts.before), mark, document.createTextNode(parts.after));
      caption.scrollTop = Math.max(0, mark.offsetTop - 8);
    } else caption.textContent = text;
    if (state.guideText !== before.guideText) $('#guide-announcement').textContent = text;
  }
  $('#guide-playback-icon').hidden = !speaking && !preparing;
  const guideName = document.querySelector('#companion-pet')?.dataset.guideName ?? $('.guide-name strong')?.textContent ?? '数字导游';
  $('#replay-guide').setAttribute('aria-label', speaking || preparing ? (state.voiceSession ? '打断讲解，我来说' : '停止讲解') : `重听${guideName}的话`);
  $('#speech-button').setAttribute('aria-pressed', String(voice.pressed));
  $('#speech-button').setAttribute('aria-busy', String(voice.busy));
  $('#speech-button').setAttribute('aria-label', voice.label);
  $('#speech-button').title = voice.label;
  $('#speech-button').dataset.voiceState = voice.status;
  $('#speech-button').dataset.listening = String(voice.listening);
  if (voice.icon !== lastSpeechIcon) { $('#speech-button').innerHTML = icon(voice.icon); lastSpeechIcon = voice.icon; }
  voiceInput.placeholder = state.guideStatus === 'listening' ? '我在听…' : state.voiceSession ? '陪聊中 · 随时可以暂停' : `想去哪里？问问${guideName}`;
  if (state.guideError && state.guideError !== before.guideError) voiceStatus(state.guideError);
  if (state.suggestions !== before.suggestions) {
    $('#guide-suggestions').replaceChildren(...(state.suggestions ?? []).map(item => {
      const button = document.createElement('button'); button.type='button'; button.textContent=item.label;
      button.addEventListener('click', () => { void submitText(item.text); }); return button;
    }));
  }
  const cue = state.narrationCue;
  const showCue = speaking && cue?.poiId === state.selectedPoiId && inScene && !state.detailsOpen;
  $('#scene-cue').hidden = !showCue;
  if (showCue) $('#scene-cue').textContent = cue.text;
  if (inPanorama && (sceneChanged || retryRequested)) startPanorama(poi);
  if (state.view === 'photo' && (sceneChanged || retryRequested)) startPhoto(poi);
  if (pendingInitialArrival && companion && state.voiceSession && state.guideStatus === 'idle' && before.guideText === COMPANION_GREETING && ['preparing', 'speaking'].includes(before.guideStatus)) {
    pendingInitialArrival = false;
    queueMicrotask(() => {
      const current = store.get();
      if (current.tourMode === 'companion' && !current.companionPaused && current.visitorOrigin && current.guideStatus === 'idle') arrival.update(current.visitorOrigin);
    });
  }
}
const unsubscribe = store.subscribe(render);
render(store.get());
guide.proactive('welcome');

const catalog = $('#catalog-sheet');
function updateCatalog() {
  const result = catalogResults($('#catalog-search').value, $('#catalog-region').value);
  $('#catalog-results').innerHTML = result.html;
  $('#catalog-count').textContent = `${result.count} 条公开记录 · 不是完整在营名录`;
}
$('#open-catalog').addEventListener('click', () => { cancelInput(); guide.interrupt(); updateCatalog(); catalog.showModal(); });
$('#close-catalog').addEventListener('click', () => catalog.close());
$('#catalog-search').addEventListener('input', updateCatalog);
$('#catalog-region').addEventListener('change', updateCatalog);
$('#catalog-results').addEventListener('click', event => {
  const id = event.target.closest('[data-catalog-poi]')?.dataset.catalogPoi;
  if (id) { catalog.close(); void voiceSession.run(() => guide.openPoi(id)); }
});
$('#photo-details').addEventListener('click', () => { void voiceSession.run(() => guide.showDetails()); });
$('#retry-photo').addEventListener('click', () => { void voiceSession.run(() => guide.retryScene(store.get().selectedPoiId)); });
for (const event of ['pointerdown','keydown','input']) document.addEventListener(event, () => { lastInteraction = Date.now(); }, {passive:true});
const proactiveTimer = setInterval(() => {
  if (store.get().tourMode === 'companion' || document.hidden || catalog.open || about.open || microphoneSheet.open || document.activeElement === voiceInput || Date.now() - lastInteraction < 60000 || !store.get().messages.some(item=>item.role === 'user')) return;
  guide.proactive('next');
}, 10000);

$('#back-map').addEventListener('click', () => { void voiceSession.run(() => guide.showMap()); });
$('#close-visit').addEventListener('click', () => { void voiceSession.run(() => { guide.interrupt(); store.set({ visitInfo: null }); }); focusScene(); });
hotspotLayer.addEventListener('click', event => {
  const id = event.target.closest('[data-hotspot]')?.dataset.hotspot;
  if (id) void voiceSession.run(() => guide.showDetails(id));
});
$('#panorama-zoom-in').addEventListener('click', () => panorama?.zoomBy(-8));
$('#panorama-zoom-out').addEventListener('click', () => panorama?.zoomBy(8));
$('#panorama-reset').addEventListener('click', () => panorama?.reset());
$('#retry-panorama').addEventListener('click', () => {
  void voiceSession.run(() => guide.retryScene(store.get().selectedPoiId));
  (['error', 'unsupported'].includes(panorama?.getView().status) ? $('#retry-panorama') : canvas).focus({ preventScroll: true });
});
function activateCompanion() {
  if (store.get().tourMode === 'companion' && store.get().companionPaused) { toggleCompanion(); return; }
  if (voiceSession.active) { voiceSession.interruptAndListen(); return; }
  if (store.get().tourMode === 'interactive' && store.get().interactionInput === 'voice' && ['speaking', 'preparing'].includes(store.get().guideStatus)) {
    voiceManuallyPaused = false; cancelAutomaticListening(); startVoiceSession({ userInitiated: true }); return;
  }
  if (['speaking', 'preparing'].includes(store.get().guideStatus)) guide.stop(); else guide.resumeNarration();
}
$('#replay-guide').addEventListener('click', activateCompanion);
const disposeCompanion = mountCompanionDemo({ host: $('.voice-dock'), stage: $('.scene-surface'), store, onActivate: activateCompanion });
const disposeModeWorkspace = mountModeWorkspace({ app, store,
  onOpenRecommendation:id => { void voiceSession.run(() => guide.openPoiWithDetails(id)); },
  onDismissRecommendation:id => guide.dismissRecommendation(id),
});

const disposeWorkspaceResize = mountWorkspaceResize({ app, store });

// The default state is an open listening experience. Browsers may still require
// a permission gesture; in that case the same control remains the retry button.
scheduleAutomaticListening();

async function submitText(text) {
  if (!text.trim()) return;
  voiceInput.value = ''; dictatedText = ''; updateInput(); voiceInput.blur();
  await voiceSession.run(() => guide.submit(text));
}
voiceInput.addEventListener('focus', () => { cancelAutomaticListening(); if (voiceSession.active) voiceSession.stop({ message: '打字告诉我也可以。' }); });
voiceInput.addEventListener('input', updateInput);
inputToggle.addEventListener('click', () => {
  const next = store.get().interactionInput === 'voice' ? 'text' : 'voice';
  cancelAutomaticListening();
  voiceSession.stop();
  guide.interrupt();
  store.set({ interactionInput: next });
  if (next === 'text') voiceInput.focus({ preventScroll: true });
  else {
    voiceInput.blur(); inputToggle.focus({ preventScroll: true });
    voiceManuallyPaused = false;
    startVoiceSession({ userInitiated: true });
  }
});
$('#voice-form').addEventListener('submit', event => { event.preventDefault(); void submitText(voiceInput.value); });
$('#speech-button').addEventListener('click', () => {
  voiceInput.blur();
  const action = voicePresentation(store.get(), { starting: automaticVoiceStartPending }).action;
  cancelAutomaticListening();
  if (action === 'interrupt') {
    voiceManuallyPaused = false;
    if (voiceSession.active) voiceSession.interruptAndListen(); else startVoiceSession({ userInitiated: true });
  } else if (action === 'pause') {
    voiceManuallyPaused = true;
    voiceSession.stop({ message: '聆听已暂停，想继续时点击麦克风。' });
  } else {
    voiceManuallyPaused = false;
    startVoiceSession({ userInitiated: true });
  }
});

$('#microphone-help').addEventListener('click', () => {
  cancelAutomaticListening();
  renderMicrophoneHelp(store.get());
  microphoneSheet.showModal();
});
$('#close-microphone').addEventListener('click', () => microphoneSheet.close());
$('#enable-microphone').addEventListener('click', () => {
  microphoneSheet.close();
  cancelAutomaticListening(); voiceManuallyPaused = false;
  startVoiceSession({ userInitiated: true });
});
$('#microphone-use-text').addEventListener('click', () => {
  microphoneSheet.close(); cancelInput(); guide.interrupt();
  if (store.get().tourMode === 'companion') {
    $('#mode-menu [data-tour-mode="interactive"]').click();
    cancelInput();
  }
  store.set({ interactionInput: 'text' });
  voiceInput.focus({ preventScroll: true });
});

$('#about-button').addEventListener('click', () => { cancelInput(); guide.interrupt(); about.showModal(); });
$('#close-about').addEventListener('click', () => about.close());
$('#try-speaking').addEventListener('click', () => { about.close(); cancelInput(); guide.resumeNarration(); });
document.addEventListener('visibilitychange', () => {
  if (store.get().tourMode === 'companion') {
    voiceSession.setBackground(document.hidden);
    if (document.hidden) cancelAutomaticListening();
    else scheduleAutomaticListening();
    return;
  }
  if (document.hidden) {
    cancelAutomaticListening();
    // Keep the recovery instructions while the visitor changes site/system permissions.
    if (voiceSession.active || !store.get().voiceErrorCode) {
      voiceSession.stop({ message: '陪游已暂停，回来后点麦克风继续。' });
      voiceStatus('陪游已暂停，回来后可以继续。');
    }
    if (about.open) about.close();
    if (catalog.open) catalog.close();
  }
});
window.addEventListener('pagehide', event => {
  if (!event.persisted) disposeCompanion();
  if (event.persisted) simulator.setPaused(true); else simulator.dispose();
  stopLocation();
  cancelInput(); guide.interrupt();
  if (!event.persisted) { clearInterval(proactiveTimer); disposeWorkspaceResize(); disposeModeWorkspace(); voiceSession.dispose(); guide.dispose(); speech.dispose?.(); disposeMap(); disposePanorama(); disposeViewport(); unsubscribe(); }
});

window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  simulator.setPaused(store.get().companionPaused);
  if (store.get().tourMode === 'companion') scheduleAutomaticListening();
});

// Connection state describes the backend's reported mode, never just its URL.
getServiceStatus().then(status => {
  $('#guide-service-status').textContent = status.guide === 'connected'
    ? status.mode === 'live' ? '在线导游已连接，可询问园区知识；地图与景点操作由本地指令处理。' : '后端当前为规则演示模式，尚未启用在线模型。'
    : '当前使用本地景点指令，在线导游暂不可用。';
  if (status.nativeVoice?.ready) $('#guide-service-status').textContent += ' 麦克风对话使用后端原生语音；点击景点的固定讲解仍由浏览器朗读。';
}).catch(() => { $('#guide-service-status').textContent = '在线导游状态暂不可用，仍可使用本地景点指令。'; });
