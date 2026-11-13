/** Locally hosted piano recordings (CC BY 3.0); see docs/FULL_DUPLEX_CALL.md. */
export function createCallSounds({ scope = globalThis } = {}) {
  let context = null, loading = null, generation = 0, disposed = false;
  const buffers = {}, nodes = new Set();
  const files = { dial: '/assets/audio/call-dial.wav', connected: '/assets/audio/call-connected.wav', ended: '/assets/audio/call-ended.wav' };
  const levels = { dial: .22, connected: .32, ended: .28 };
  async function unlock() {
    if (disposed) return false;
    const AudioContext = scope.AudioContext || scope.webkitAudioContext;
    if (!AudioContext) return false;
    context ??= new AudioContext({ latencyHint: 'interactive' });
    // Called in the initiating tap, before any network/permission await.
    const resume = context.resume();
    loading ??= Promise.all(Object.entries(files).map(async ([name, path]) => {
      const response = await scope.fetch(path);
      if (!response.ok) throw new Error('通话音效加载失败');
      buffers[name] = await context.decodeAudioData(await response.arrayBuffer());
    })).catch(() => { loading = null; return false; });
    await resume; return await loading !== false;
  }
  function stop() {
    generation++;
    for (const node of nodes) { try { node.stop(); } catch {} }
    nodes.clear();
  }
  return {
    unlock,
    async play(name) {
      stop(); const token = generation;
      try {
        if (!await unlock() || token !== generation || disposed) return;
        const node = context.createBufferSource(), gain = context.createGain();
        node.buffer = buffers[name]; gain.gain.value = levels[name];
        node.connect(gain); gain.connect(context.destination); nodes.add(node);
        node.onended = () => { nodes.delete(node); node.disconnect(); gain.disconnect(); };
        node.start();
      } catch { /* Sound failure must not strand the microphone or the call button. */ }
    },
    stop,
    dispose() { disposed = true; stop(); void context?.close().catch(() => {}); },
  };
}
