import * as ort from '/assets/call-vad/ort.wasm.min.mjs';
import { createSpeechGate } from './call-vad-state.js';

// One 16 kHz capture stream feeds both Qwen and this isolated, single-threaded model.
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = new URL('/assets/call-vad/', self.location.href).href;
const gate = createSpeechGate();
const sr = new ort.Tensor('int64', BigInt64Array.of(16000n), []);
let session, state, inFlightState, epoch = 0, running = false, failed = false;
let frame = new Float32Array(512), context = new Float32Array(64), offset = 0;
const queue = [];
function reset() {
  if (state !== inFlightState) state?.dispose();
  state = new ort.Tensor('float32', new Float32Array(256), [2, 1, 128]);
  frame = new Float32Array(512); context = new Float32Array(64); offset = 0; gate.reset();
}
async function infer(samples, token, frameEndSample, frameEndClientMs) {
  const input = new Float32Array(576); input.set(context); input.set(samples, 64);
  const tensor = new ort.Tensor('float32', input, [1, 576]);
  const previous = inFlightState = state;
  const result = await session.run({ input: tensor, state: previous, sr });
  tensor.dispose(); previous.dispose(); inFlightState = null;
  if (token !== epoch) { result.stateN.dispose(); result.output.dispose(); return; }
  state = result.stateN; context.set(samples.subarray(448));
  const event = gate.process(result.output.data[0]); result.output.dispose();
  if (event) self.postMessage({ type: event, epoch, frameEndSample, frameEndClientMs,
    boundarySample: frameEndSample - (event === 'speech_started' ? 3 : 8) * 512,
    boundaryClientMs: frameEndClientMs - (event === 'speech_started' ? 96 : 256),
  });
}
async function drain() {
  if (running || !session) return;
  running = true;
  try {
    while (queue.length) {
      const { pcm, epoch: token, sampleEnd, captureMs } = queue.shift();
      if (token !== epoch) continue;
      const data = new DataView(pcm);
      for (let at = 0; at < data.byteLength && token === epoch; at += 2) {
        frame[offset++] = data.getInt16(at, true) / 32768;
        if (offset === 512) {
          const samples = frame, remaining = (data.byteLength - at - 2) / 2;
          frame = new Float32Array(512); offset = 0;
          await infer(samples, token, sampleEnd - remaining, captureMs - remaining / 16);
        }
      }
      self.postMessage({ type: 'consumed', epoch: token });
    }
  } catch { self.postMessage({ type: 'error' }); failed = true; queue.length = 0; }
  finally { running = false; }
}
self.onmessage = ({ data }) => {
  if (failed) return;
  if (data.type === 'reset') { epoch = data.epoch; queue.length = 0; reset(); }
  if (data.type === 'pcm' && data.epoch === epoch) { queue.push(data); void drain(); }
};
try {
  session = await ort.InferenceSession.create('/assets/call-vad/silero_vad_v5.onnx', { executionProviders: ['wasm'] });
  reset();
  await infer(new Float32Array(512), epoch); // Warm the runtime before the call is connected.
  reset(); self.postMessage({ type: 'ready' });
} catch { failed = true; self.postMessage({ type: 'error' }); }
