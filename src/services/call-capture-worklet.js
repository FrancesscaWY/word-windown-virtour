/** Audio-thread capture: continuous, drift-free 16 kHz PCM in 20 ms packets. */
class CallCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.weight = 0; this.sum = 0; this.offset = 0;
    this.packet = new ArrayBuffer(640); this.view = new DataView(this.packet);
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const value of input) {
      let remaining = 1;
      while (remaining > 1e-8) {
        const used = Math.min(remaining, this.ratio - this.weight);
        this.sum += value * used; this.weight += used; remaining -= used;
        if (this.weight >= this.ratio - 1e-8) {
          const sample = Math.max(-1, Math.min(1, this.sum / this.ratio));
          this.view.setInt16(this.offset, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
          this.offset += 2; this.sum = 0; this.weight = 0;
          if (this.offset === 640) {
            this.port.postMessage(this.packet, [this.packet]);
            this.packet = new ArrayBuffer(640); this.view = new DataView(this.packet); this.offset = 0;
          }
        }
      }
    }
    return true;
  }
}
registerProcessor('call-capture', CallCaptureProcessor);
