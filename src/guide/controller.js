import { pois, getPoi, getHotspot, detailSections } from '../data/pois.js';
import { resolveLocalIntent } from './intent.js';
import { toolEffect } from './tool-effects.js';

import { facilityResult, facilities } from '../data/facilities.js';

const MESSAGE_LIMIT = 12;
const ALL_POIS = pois.map(poi => poi.id);

function openingNarration(poi) { return poi.panoramaNarration ?? poi.summary; }

export function narrationCue(text, index, poiId) {
  if (!poiId || !Number.isFinite(index)) return null;
  const parts = [...text.matchAll(/[^。！？]+[。！？]?/g)];
  const part = parts.find(item => index >= item.index && index < item.index + item[0].length) ?? parts.at(-1);
  return part ? { poiId, sentence: parts.indexOf(part), text: part[0] } : null;
}

/** All local clicks, transcripts and text commands use this one execution path. */
export function createGuideController({ store, actions, speech, resolveIntent = resolveLocalIntent }) {
  if (!store?.get || !store?.set || !actions) throw new Error('Guide controller needs a store and tour actions.');
  let generation = 0;
  let pendingRequest = null;
  let disposed = false;
  let sceneReadyId = null;
  let lastNarration = null;
  const narrated = new Set();
  const offered = new Set();
  let lastProactiveAt = -Infinity;
  const appliedTools = new Set();

  const current = token => !disposed && token === generation;
  function appendMessage(role, text) {
    const row = { role, text, content: text };
    const messages = [...store.get().messages, row].slice(-MESSAGE_LIMIT);
    store.set({ messages });
    return row;
  }

  function begin() {
    if (disposed) return null;
    pendingRequest?.abort();
    pendingRequest = null;
    generation += 1;
    appliedTools.clear();
    speech?.stop?.();
    store.set({ guideStatus: 'idle', guideError: null, pendingNarration: null, speechCharIndex: null, narrationCue: null, suggestions: [], sessionId: generation });
    return generation;
  }

  function speak(text, token, { poiId = null, requiresScene = false, optional = false } = {}) {
    if (!current(token)) return;
    lastNarration = { text, poiId, requiresScene };
    if (['connecting', 'connected'].includes(store.get().callState)) return;
    if (store.get().tourMode === 'immersive' || (store.get().tourMode === 'interactive' && store.get().interactionInput === 'text') || (store.get().tourMode === 'companion' && store.get().companionPaused)) return;
    store.set({ guideStatus: 'preparing', speechCharIndex: null });
    let result;
    try { result = speech?.speak ? speech.speak(text, {
      onStart() { if (current(token)) store.set({ guideStatus: 'speaking', narrationCue: narrationCue(text, 0, poiId) }); },
      onBoundary(index) { if (current(token)) store.set({ speechCharIndex: index, narrationCue: narrationCue(text, index, poiId) }); },
    }) : { status: 'unsupported' }; }
    catch { result = { status: 'error' }; }
    Promise.resolve(result).then(outcome => {
      if (!current(token)) return;
      store.set({ guideStatus: 'idle', speechCharIndex: null, narrationCue: null, guideError: !optional && ['error', 'unsupported'].includes(outcome?.status) ? '语音播报暂时不可用，文字讲解已显示。' : null });
    }, () => {
      if (current(token)) store.set({ guideStatus: 'idle', speechCharIndex: null, narrationCue: null, guideError: optional ? null : '语音播报暂时不可用，文字讲解已显示。' });
    });
  }

  function reply(text, token, { aloud = true, patch = {}, poiId = null, requiresScene = false, optional = false } = {}) {
    if (!current(token)) return false;
    store.set({ guideText: text, guideStatus: 'idle', pendingNarration: null, ...patch });
    appendMessage('assistant', text);
    if (aloud) speak(text, token, { poiId, requiresScene, optional });
    return true;
  }

  function clarify(intent, token) {
    const candidates = [...new Set((intent.candidates ?? ALL_POIS).filter(id => getPoi(id)))];
    const names = candidates.slice(0, 3).map(id => getPoi(id).name).join('、');
    const pendingIntent = { type: intent.pendingIntent?.type ?? 'open-poi' };
    const text = intent.kind === 'multiple-pois' ? `你提到了几处风景，我们先看哪一个？${names}。` : `你想了解哪个景点？可以说${names || '铁塔、凯旋门或金字塔'}。`;
    return reply(text, token, { patch: { clarification: { kind: intent.kind ?? 'choose-poi', candidates: candidates.length ? candidates : [...ALL_POIS], pendingIntent }, lastIntent: pendingIntent, visitInfo: null, recommendedPoiIds: [] } });
  }

  function open(id, token, force = false) {
    store.set({facilityInfo:null});
    const poi = getPoi(id);
    if (!poi) return clarify({ kind: 'choose-poi', pendingIntent: { type: 'open-poi' } }, token);
    const state = store.get();
    const alreadyReady = state.view !== 'map' && state.selectedPoiId === id && sceneReadyId === id;
    const text = openingNarration(poi);
    if (state.tourMode === 'companion') {
      actions.showMap();
      return reply(text, token, { poiId:id, patch:{ selectedPoiId:id, mentionedPoiId:id, lastIntent:{type:'open-poi'}, clarification:null, visitInfo:null, recommendedPoiIds:[] } });
    }
    const repeated = narrated.has(id) && !force;
    lastNarration = { text, poiId: id, requiresScene: Boolean(poi.panorama || poi.photo) };
    if (poi.panorama || poi.photo) {
      if (repeated) {
        sceneReadyId = alreadyReady ? id : null;
        actions.enterPanorama(id);
        return reply(`又见到${poi.name}。想再听一次，点一下导游就好。`, token, { aloud: false, patch: { mentionedPoiId:id, clarification:null, visitInfo:null, recommendedPoiIds:[], suggestions:[{label:'再听一次',text:'继续讲解'}] } });
      }
      sceneReadyId = alreadyReady ? id : null;
      store.set({ mentionedPoiId: id, guideText: `带你走近${id === 'eiffel' ? '铁塔' : poi.name}…`, guideStatus: 'waiting', pendingNarration: { id, text, token }, lastIntent: { type: 'open-poi' }, clarification: null, recommendedPoiIds: [], visitInfo: null });
      actions.enterPanorama(id);
      if (current(token) && alreadyReady) sceneReady(id);
      return true;
    }
    sceneReadyId = null;
    actions.enterPanorama(id);
    narrated.add(id);
    return reply(text, token, { aloud: !repeated, poiId: id, patch: { mentionedPoiId: id, lastIntent: { type: 'open-poi' }, clarification: null, recommendedPoiIds: [], visitInfo: null } });
  }

  function details(intent, token) {
    store.set({facilityInfo:null});
    const state = store.get();
    const id = intent.poiId ?? state.mentionedPoiId;
    const poi = getPoi(id);
    if (!poi) return clarify({ kind: 'choose-poi', pendingIntent: { type: 'details' } }, token);
    const hotspot = getHotspot(id, intent.hotspotId);
    if (intent.hotspotId && !hotspot) return reply('没有找到这个画面细节，可以先看看景点详情。', token, { patch: { clarification: null } });
    if (state.selectedPoiId !== id) { sceneReadyId = null; actions.selectPoi(id); }
    if (state.tourMode === 'companion') actions.showMap();
    else actions.showDetails(hotspot?.id ?? null);
    const text = hotspot ? `${hotspot.title}：${hotspot.body} 这是原创测试画面。` : `${poi.name}：${(detailSections[id] ?? []).map(part => part.text).join('\n\n') || poi.summary}`;
    return reply(text, token, { poiId: id, patch: { mentionedPoiId: id, lastIntent: { type: 'details' }, clarification: null, recommendedPoiIds: [], visitInfo: null } });
  }

  function visit(intent, token) {
    store.set({facilityInfo:null});
    const poi = getPoi(intent.poiId);
    if (!poi) return clarify({ kind: 'choose-poi', pendingIntent: { type: intent.type } }, token);
    const visitInfo = { id: poi.id, region: poi.region, source: '尚无实时数据' };
    const text = `${poi.name}属于${poi.region}。${intent.type === 'crowd' ? '我还没有实时人流和排队数据，不能判断现在是否拥挤。' : '还没有你的定位和可用步行路线，暂时不能估算距离。'}${poi.photo ? '我有一张园内实拍，可以先带你看看。' : '可以先看看景点资料，再结合现场路牌安排路线。'}`;
    return reply(text, token, { poiId: poi.id, patch: { mentionedPoiId: poi.id, lastIntent: { type: intent.type }, visitInfo, detailsOpen: false, activeHotspotId: null, clarification: null, recommendedPoiIds: [], suggestions:[{label:'带我看看',text:`看看${poi.name}`}]} });
  }

  function recommend(token, preference = store.get().preference) {
    store.set({facilityInfo:null});
    const choices = preference === 'architecture' ? ['colosseum','cologne','arc'] : preference === 'family' ? ['pyramid','borobudur','eiffel'] : ['eiffel','pisa','versailles'];
    const id = choices.find(id => !narrated.has(id)) ?? choices[0];
    const poi = getPoi(id);
    const reason = preference === 'architecture' ? '喜欢建筑故事，可以从层叠的拱门与柱廊看起。' : preference === 'family' ? '带孩子一起找形状、认建筑，也很有趣。' : '想拍照，可以先找一个鲜明的建筑轮廓。';
    return reply(`${reason}推荐${poi.name}，要带你看看吗？`, token, { poiId:id, patch:{ preference, mentionedPoiId:id, lastIntent:{type:'recommend'}, recommendedPoiIds:[id], visitInfo:null, clarification:{kind:'confirm-recommendation',candidates:[id],pendingIntent:{type:'open-poi'}}, suggestions:[{label:'带我看看',text:'好的'},{label:'先自己逛',text:'不用了'}]} });
  }

  function map(token) {
    store.set({facilityInfo:null});
    sceneReadyId = null;
    actions.showMap();
    return reply('回到地图啦，下一站听你的。', token, { patch: { lastIntent: { type: 'map' }, clarification: null, recommendedPoiIds: [], visitInfo: null } });
  }

  function resume(token) {
    if (!lastNarration) return reply('想听哪处风景？可以说“介绍铁塔”。', token, { patch: { clarification: null } });
    const state = store.get();
    if (lastNarration.requiresScene && state.view !== 'map' && state.selectedPoiId === lastNarration.poiId && sceneReadyId !== lastNarration.poiId) {
      store.set({ guideText: '等画面准备好，我再继续讲解。', guideStatus: 'waiting', pendingNarration: { id: lastNarration.poiId, text: lastNarration.text, token } });
      return true;
    }
    return reply(lastNarration.text, token, { poiId: lastNarration.poiId, requiresScene: lastNarration.requiresScene, patch: { clarification: null } });
  }

  function showFacilities(kind, id, token) {
    const info = facilityResult(kind, id);
    sceneReadyId = null;
    actions.showMap();
    return reply(info.text, token, {patch:{facilityInfo:info,mentionedPoiId:null,clarification:null,recommendedPoiIds:[],visitInfo:null,lastIntent:{type:'facility'},detailsOpen:false}});
  }

  function applyToolTraces(traces, token) {
    if (!current(token) || !Array.isArray(traces)) return;
    for (const trace of traces) {
      if (!trace?.id || appliedTools.has(trace.id)) continue;
      const patch = toolEffect(trace);
      if (!patch) continue;
      appliedTools.add(trace.id);
      sceneReadyId = null;
      store.set(patch);
    }
  }

  function execute(intent, token) {
    if (!current(token)) return false;
    switch (intent?.type) {
      case 'answer':
        applyToolTraces(intent.traces, token);
        return reply(intent.text, token, { patch: { mode: intent.mode, guideModel: intent.model ?? null, guideTraces: intent.traces ?? [], clarification: null, visitInfo: null } });
      case 'service-error': return reply(intent.text, token, { aloud: false, patch: { guideError: intent.text, mode: 'local-rules', guideModel: null, guideTraces: [] } });
      case 'facility': return showFacilities(intent.kind, intent.id ?? null, token);
      case 'open-poi': return open(intent.poiId, token, intent.forceNarration);
      case 'details': return details(intent, token);
      case 'distance': case 'crowd': return visit(intent, token);
      case 'recommend': return recommend(token, intent.preference);
      case 'map': return map(token);
      case 'stop': store.set({proactiveSuppressed:true}); return reply('好，先停一下。想继续时可以说“继续讲解”。', token, { aloud: false, patch: { clarification: null } });
      case 'resume': return resume(token);
      case 'reject': store.set({proactiveSuppressed:true}); return reply('好的，先不切换。想看哪里，再告诉我。', token, { patch: { clarification: null, recommendedPoiIds: [], visitInfo: null } });
      case 'acknowledge': return reply('我在。想看哪里，或者想了解什么？', token);
      case 'clarify': return clarify(intent, token);
      case 'unsupported-save': return reply('这版体验还不能代你保存图片。我可以先展开景点详情给你看。', token, { patch: { clarification: null } });
      default: return reply('这版陪游可以打开景点、展开详情、按兴趣推荐风景。你也可以说“推荐一处风景”。', token, { patch: { clarification: null } });
    }
  }

  function sceneReady(id) {
    if (disposed || store.get().view === 'map' || store.get().selectedPoiId !== id) return false;
    sceneReadyId = id;
    const pending = store.get().pendingNarration;
    if (!pending || pending.id !== id || !current(pending.token)) return false;
    narrated.add(id);
    return reply(pending.text, pending.token, { poiId: id, requiresScene: true });
  }

  return {
    async submitAudio(audio) {
      if (disposed) return { status: 'disposed' };
      if (!speech?.respondToAudio) return { status: 'error' };
      const context = store.get(), token = begin();
      const row = appendMessage('user', '语音提问（等待字幕）');
      const request = new AbortController(); pendingRequest = request;
      let transcript = '', answer = null, stopped = false, audioStarted = false;
      store.set({ guideStatus: 'thinking', mode: 'backend-native', guideError: null });
      try {
        const result = await speech.respondToAudio(audio, context, {
          signal: request.signal,
          onTranscript(text) {
            if (!current(token)) return;
            transcript = text;
            store.set({ currentTranscript: text, messages: store.get().messages.map(message => message === row ? { ...row, text, content: text } : message) });
            const intent = resolveLocalIntent(text, context);
            if (intent.type === 'stop') {
              stopped = true; request.abort(); speech.stopSpeaking();
              execute(intent, token); return;
            }
            // UI actions use the transcript; Qwen retains ownership of its spoken answer.
            if (intent.type === 'map') { sceneReadyId = null; actions.showMap(); store.set({ facilityInfo: null }); }
            else if (intent.type === 'open-poi' && getPoi(intent.poiId)) {
              sceneReadyId = null;
              if (context.tourMode === 'companion') { actions.selectPoi(intent.poiId); actions.showMap(); }
              else actions.enterPanorama(intent.poiId);
              store.set({ mentionedPoiId: intent.poiId, facilityInfo: null, clarification: null });
            } else if (intent.type === 'facility') {
              sceneReadyId = null; actions.showMap();
              store.set({ facilityInfo: facilityResult(intent.kind, intent.id), mentionedPoiId: null, clarification: null });
            } else if (intent.type === 'details' && getPoi(intent.poiId)) {
              actions.selectPoi(intent.poiId); actions.showDetails(intent.hotspotId ?? null);
              store.set({ mentionedPoiId: intent.poiId });
            }
          },
          onStart() { if (current(token)) { audioStarted = true; store.set({ guideStatus: 'speaking' }); } },
          onToolEnd(trace) { applyToolTraces([trace], token); },
          onAnswer(event) {
            if (!current(token)) return;
            applyToolTraces(event.traces, token);
            answer = event;
            lastNarration = { text: event.content, poiId: null, requiresScene: false };
            store.set({ guideText: event.content, guideModel: event.model ?? null, guideTraces: event.traces ?? [], guideStatus: audioStarted ? 'speaking' : 'preparing' });
            appendMessage('assistant', event.content);
          },
        });
        if (stopped) return { status: 'executed', intent: 'stop' };
        if (!current(token)) return { status: 'cancelled' };
        pendingRequest = null;
        if (result.status === 'cancelled') { store.set({ guideStatus: 'idle' }); return { status: 'cancelled' }; }
        if (result.status !== 'success') throw new Error('后端已返回字幕，但没有成功播放语音，请点击导游重试。');
        store.set({ guideStatus: 'idle', currentTranscript: transcript, guideError: null });
        return { status: 'executed', intent: 'answer' };
      } catch (error) {
        if (stopped) return { status: 'executed', intent: 'stop' };
        if (!current(token)) return { status: 'cancelled' };
        pendingRequest = null;
        const message = error.name === 'TimeoutError' ? '语音回答超时，请稍后重试。' : error.message || '语音回答失败，请稍后重试。';
        if (answer) store.set({ guideStatus: 'idle', guideError: message });
        else reply(message, token, { aloud: false, patch: { guideError: message } });
        return { status: 'error' };
      }
    },
    async submit(input) {
      if (disposed) return { status: 'disposed' };
      const text = String(input ?? '').trim().slice(0, 2000);
      if (!text || !/[\p{L}\p{N}]/u.test(text)) return { status: 'empty' };
      const context = store.get();
      const token = begin();
      appendMessage('user', text);
      store.set({ currentTranscript: text, guideStatus: 'thinking', mode: 'local-rules' });
      let intent;
      const request = new AbortController();
      pendingRequest = request;
      try { intent = await resolveIntent(text, context, { signal: request.signal }); }
      catch {
        if (!current(token)) return { status: 'cancelled' };
        reply('这次没能处理好。可以再说一次，比如“带我看看铁塔”。', token, { aloud: false, patch: { guideError: '这次需求未能处理，请重试。' } });
        return { status: 'error' };
      }
      if (!current(token)) return { status: 'cancelled' };
      pendingRequest = null;
      if (intent?.type === 'open-poi' && /介绍|讲|解说/.test(text)) intent.forceNarration = true;
      execute(intent, token);
      return { status: intent?.type === 'service-error' ? 'error' : intent?.type === 'clarify' ? 'clarification' : 'executed', intent: intent?.type ?? 'unknown' };
    },
    proactive(kind = 'welcome', now = Date.now()) {
      const state = store.get();
      if (disposed || state.proactiveSuppressed || state.view !== 'map' || state.detailsOpen || state.facilityInfo || state.guideStatus !== 'idle' || state.clarification || offered.has(kind) || now - lastProactiveAt < 60000) return false;
      offered.add(kind); lastProactiveAt = now;
      // The map conversation surface provides its own non-interactive examples.
      // Entering the page should not create a synthetic assistant message.
      if (kind === 'welcome') return true;
      const token = begin();
      return reply('下一站，换一种风景？告诉我你喜欢什么。', token, {aloud:false,patch:{suggestions:[{label:'拍照打卡',text:'我想拍照'},{label:'建筑故事',text:'我想看建筑'},{label:'亲子探索',text:'带孩子逛逛'}]}});
    },
    announceMode(text) {
      const token = begin();
      return token !== null && reply(text, token, { optional:true });
    },
    showFacilities(kind, id = null) {
      if (id && !facilities.some(item => item.id === id)) return false;
      const token = begin(); return token !== null && showFacilities(kind, id, token);
    },
    retryScene(id) { sceneReadyId = null; narrated.delete(id); const token = begin(); return token !== null && open(id, token, true); },
    openPoi(id) { const token = begin(); return token !== null && open(id, token); },
    openPoiWithDetails(id) {
      if (!getPoi(id)) return false;
      const token = begin();
      if (token === null) return false;
      const opened = open(id, token, true);
      // Scene narration enters the same conversation after the image is ready.
      return opened;
    },
    dismissRecommendation(id) {
      const state = store.get();
      const confirming = state.clarification?.kind === 'confirm-recommendation' && state.clarification.candidates.includes(id);
      store.set({ recommendedPoiIds:state.recommendedPoiIds.filter(item => item !== id),
        ...(confirming ? { clarification:null, suggestions:[] } : {}), proactiveSuppressed:true });
    },
    narrateLocation(id) {
      if (store.get().companionPaused) return false;
      const poi = getPoi(id);
      if (!poi || disposed) return false;
      const token = begin();
      actions.showMap();
      return reply(`你已来到${poi.name}。${poi.summary}`, token, { poiId: id, patch: { selectedPoiId: id, mentionedPoiId: id, facilityInfo: null } });
    },
    showDetails(hotspotId = null) {
      const state = store.get();
      const token = begin();
      return token !== null && details({ poiId: state.selectedPoiId, hotspotId }, token);
    },
    showMap() { const token = begin(); return token !== null && map(token); },
    clearRoute() { store.set({ plannedRoute: null }); },
    stop() { const token = begin(); return token !== null && execute({ type: 'stop' }, token); },
    interrupt() { return begin() !== null; },
    whenSceneReady: sceneReady,
    whenSceneFailed(id) {
      if (disposed || store.get().view === 'map' || store.get().selectedPoiId !== id) return false;
      sceneReadyId = null;
      const token = begin();
      return reply('这处画面暂时没加载出来。我先停下讲解，你可以重试，或返回地图继续探索。', token, { aloud: false, patch: { guideError: '画面暂时无法加载。' } });
    },
    resumeNarration() { const token = begin(); return token !== null && resume(token); },
    dispose() { if (disposed) return; begin(); disposed = true; sceneReadyId = null; },
  };
}
