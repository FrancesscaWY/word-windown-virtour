import { watch } from 'node:fs';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function summarizeCall(rows, summary = {}) {
  const diagnostics = rows.filter(row => row.source === 'browser.in' && row.event.type === 'diagnostic').map(row => row.event);
  const stopped = diagnostics.filter(e => e.name === 'playback_stopped' && e.details.hadPlayer);
  const starts = diagnostics.filter(e => e.name === 'playback_started');
  const answerParts = new Map(), statuses = new Map(), internal = new Set();
  const userTurns = new Map(rows.filter(r => r.source === 'provider.in' && r.event.type === 'input_audio_buffer.speech_started')
    .map(r => [r.event.item_id, r.context.turn]));
  const responseTurns = new Map(rows.filter(r => r.source === 'browser.out' && r.event.type === 'response_started')
    .map(r => [r.event.responseId, r.event.turn]));
  const speechRanges = new Map();
  for (const { source, context, event } of rows) {
    if (source !== 'provider.in' || !['input_audio_buffer.speech_started', 'input_audio_buffer.speech_stopped'].includes(event.type)) continue;
    const turn = userTurns.get(event.item_id) ?? context.turn;
    const range = speechRanges.get(turn) ?? {};
    if (Number.isFinite(event.audio_start_ms)) range.startSample = event.audio_start_ms * 16;
    if (Number.isFinite(event.audio_end_ms)) range.endSample = event.audio_end_ms * 16;
    speechRanges.set(turn, range);
  }
  const speechIntervals = [];
  let localStart;
  for (const event of [...diagnostics].sort((a, b) => a.clientMs - b.clientMs)) {
    if (event.name === 'vad_started') localStart = event;
    if (event.name === 'mute') localStart = undefined;
    if (event.name === 'vad_stopped' && localStart) {
      speechIntervals.push({ start: localStart, end: event }); localStart = undefined;
    }
  }
  function localEndForTurn(turn, beforeMs) {
    const range = speechRanges.get(turn);
    const cloudStart = diagnostics.find(e => e.name === 'cloud_speech_started' && e.details.turn === turn);
    const previousEnd = diagnostics.filter(e => e.name === 'cloud_speech_stopped' && e.details.turn < turn).at(-1);
    return speechIntervals.filter(({ start, end }) => {
      if (end.clientMs > beforeMs) return false;
      // VAD can fire before cloud turn advancement. Match PCM boundaries when present;
      // never borrow the previous utterance just because it was the last local event.
      if (Number.isFinite(range?.startSample) && Number.isFinite(range?.endSample) && Number.isFinite(start.details.boundarySample)) {
        return start.details.boundarySample >= range.startSample && start.details.boundarySample <= range.endSample;
      }
      return end.details.turn === turn && cloudStart && end.clientMs >= cloudStart.clientMs
        && start.clientMs > (previousEnd?.clientMs ?? -Infinity);
    }).at(-1)?.end;
  }
  for (const { source, event: e } of rows) {
    if (source !== 'provider.in') continue;
    if (e.type === 'response.done') statuses.set(e.response?.id, e.response?.status);
    if (e.type.startsWith('response.function_call_arguments.')) internal.add(e.response_id);
    const kind = e.type.startsWith('response.audio_transcript.') ? 'transcript' : e.type.startsWith('response.text.') ? 'text' : null;
    if (!kind) continue;
    const key = `${e.response_id}:${e.item_id}:${e.content_index ?? 0}`;
    const part = answerParts.get(key) ?? { responseId: e.response_id, text: '', transcript: '' };
    if (e.type.endsWith('.delta')) part[kind] += e.delta ?? '';
    if (e.type.endsWith('.done')) part[kind] = e[kind] ?? part[kind];
    answerParts.set(key, part);
  }
  const benign = new Set(rows.filter(r => r.event.type === 'cancel.race_ignored').map(r => r.event.eventId));
  return {
    callId: summary.callId ?? rows[0]?.callId, status: summary.complete === true ? 'closed-and-saved' : summary.complete === false ? 'incomplete' : 'ongoing-or-unfinalized',
    startedAt: summary.startedAt ?? rows[0]?.at, endedAt: summary.endedAt, reason: summary.reason, model: summary.model,
    audio: { inputBytes: summary.bytes?.input, generatedBytes: summary.bytes?.output,
      note: 'Model WAV contains all generated audio, not just what was heard; browser events identify playback and cancellation.' },
    transcript: rows.filter(r => r.source === 'provider.in' && r.event.type === 'conversation.item.input_audio_transcription.completed')
      .map(r => ({ turn: userTurns.get(r.event.item_id) ?? r.context.turn, text: r.event.transcript, at: r.at, itemId: r.event.item_id })),
    answers: [...answerParts.values()].map(part => ({ responseId: part.responseId, text: part.transcript || part.text,
      internal: internal.has(part.responseId), status: statuses.get(part.responseId),
      playbackStarted: starts.some(e => e.details.responseId === part.responseId), interrupted: stopped.some(e => e.details.responseId === part.responseId),
      stopReasons: stopped.filter(e => e.details.responseId === part.responseId).map(e => e.details.reason),
    })),
    tools: rows.filter(r => r.source === 'browser.out' && r.event.type === 'tool_end').map(r => ({
      turn: r.event.turn, responseId: r.event.responseId, name: r.event.trace.name, args: r.event.trace.args,
      status: r.event.trace.status, durationMs: r.event.trace.duration,
    })),
    interruptions: stopped.filter(e => ['local-vad', 'cloud-vad'].includes(e.details.reason)).map(stop => {
      const vad = stop.details.reason === 'local-vad'
        ? diagnostics.find(e => e.name === 'vad_started' && e.clientMs <= stop.clientMs && stop.clientMs - e.clientMs < 100) : undefined;
      return { responseId: stop.details.responseId, source: stop.details.reason, playedMs: stop.details.playedMs,
        detectionToStopMs: vad ? +(stop.clientMs - vad.clientMs).toFixed(1) : null,
        vadEstimatedOnsetToStopMs: Number.isFinite(vad?.details.boundaryClientMs) ? +(stop.clientMs - vad.details.boundaryClientMs).toFixed(1) : null,
        inputBoundarySample: vad?.details.boundarySample, outputLatencyMs: stop.details.outputLatencyMs,
      };
    }),
    replies: starts.map(start => {
      const chunk = diagnostics.find(e => e.name === 'playback_chunk' && e.details.responseId === start.details.responseId);
      const scheduledMs = chunk ? chunk.clientMs + chunk.details.startTimeMs - chunk.details.audioTimeMs : null;
      const turn = responseTurns.get(start.details.responseId) ?? chunk?.details.turn ?? start.details.turn;
      const end = localEndForTurn(turn, scheduledMs ?? start.clientMs);
      const cloudEnd = diagnostics.find(e => e.name === 'cloud_speech_stopped' && e.details.turn === turn && e.clientMs <= start.clientMs);
      const stop = diagnostics.find(e => ['playback_done', 'playback_stopped'].includes(e.name) && e.details.responseId === start.details.responseId && e.clientMs >= start.clientMs);
      return { responseId: start.details.responseId, turn, speechBoundarySource: end ? 'local-vad' : 'unavailable',
        estimatedSpeechEndToScheduledPlaybackMs: scheduledMs !== null && Number.isFinite(end?.details.boundaryClientMs) ? Math.round(scheduledMs - end.details.boundaryClientMs) : null,
        observedSpeechEndToPlaybackCallbackMs: Number.isFinite(end?.details.boundaryClientMs) ? Math.round(start.clientMs - end.details.boundaryClientMs) : null,
        cloudEndToScheduledPlaybackMs: scheduledMs !== null && cloudEnd ? Math.round(scheduledMs - cloudEnd.clientMs) : null,
        playbackCallbackLagMs: scheduledMs !== null ? Math.round(start.clientMs - scheduledMs) : null,
        captureSamplesWhilePlaying: stop ? stop.details.inputSamples - start.details.inputSamples : null,
      };
    }),
    stalePlaybackAfterStop: stopped.flatMap(stop => diagnostics.filter(e => e.name === 'playback_chunk' && e.details.responseId === stop.details.responseId && e.clientMs > stop.clientMs)
      .map(e => ({ responseId: e.details.responseId, clientMs: e.clientMs }))),
    captureMaxGapMs: Math.max(0, ...diagnostics.filter(e => e.name === 'capture_stats').map(e => e.details.maxCaptureGapMs)),
    discardedEvents: rows.filter(r => r.event.type === 'response.event_dropped').reduce((counts, r) => { counts[r.event.reason] = (counts[r.event.reason] ?? 0) + 1; return counts; }, {}),
    muteChanges: diagnostics.filter(e => e.name === 'mute').map(e => ({ clientMs: e.clientMs, muted: e.details.muted })),
    localSpeechEvents: diagnostics.filter(e => ['vad_started', 'vad_stopped'].includes(e.name)).map(e => ({
      type: e.name, clientMs: e.clientMs, boundarySample: e.details.boundarySample, boundaryClientMs: e.details.boundaryClientMs,
    })),
    errors: rows.filter(r => r.event.type === 'error' && !benign.has(r.event.error?.event_id)).map(r => ({ source: r.source, event: r.event })),
    suspectedSpokenToolText: [...new Set(rows.filter(r => r.source === 'browser.out' && r.event.type === 'answer'
      && /\btools?\b|search_knowledge_base|plan_route|plan_itinerary|get_attraction_\w+|search_attractions|estimate_budget|function_call|工具调用|调用.{0,20}工具/i.test(r.event.text)).map(r => r.event.responseId))],
    timingNote: 'Client metrics use one monotonic browser clock. VAD boundaries are estimates, not physical acoustic measurements. Check the input WAV and actual conversation before accepting.',
  };
}

async function sessions(root) {
  const found = [];
  for (const date of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!date.isDirectory()) continue;
    for (const call of await readdir(resolve(root, date.name), { withFileTypes: true })) if (call.isDirectory()) found.push(resolve(root, date.name, call.name));
  }
  return found.sort();
}

async function waitForCall(root) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const since = Date.now();
  return new Promise((resolveCall, reject) => {
    const watcher = watch(root, async (_event, filename) => {
      if (!filename?.toString().endsWith('.complete.json')) return;
      const path = resolve(root, filename.toString());
      try {
        const marker = JSON.parse(await readFile(path, 'utf8'));
        if (Date.parse(marker.startedAt) < since) return;
        watcher.close(); resolveCall(resolve(root, marker.directory));
      } catch { /* A future rename/change event will deliver the finalized summary. */ }
    });
    watcher.on('error', error => { watcher.close(); reject(error); });
    console.log('Waiting for the next real call to end; file-event driven, no polling.');
  });
}

async function main() {
  const root = process.env.CALL_LOG_DIR || fileURLToPath(new URL('../logs/calls/', import.meta.url));
  const args = process.argv.slice(2);
  const directory = args.includes('--wait') ? await waitForCall(root) : args.find(arg => !arg.startsWith('--')) || (await sessions(root)).at(-1);
  if (!directory) throw new Error('No call journals yet.');
  const content = await readFile(resolve(directory, 'events.jsonl'), 'utf8');
  const rows = content.split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const summary = await readFile(resolve(directory, 'summary.json'), 'utf8').then(JSON.parse).catch(() => ({}));
  console.log(JSON.stringify({ directory, ...summarizeCall(rows, summary) }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
