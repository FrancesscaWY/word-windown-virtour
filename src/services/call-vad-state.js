/** Short confirmation rejects isolated clicks; hysteresis bridges pauses within speech. */
export function createSpeechGate() {
  let speaking = false, positive = 0, negative = 0;
  return {
    reset() { speaking = false; positive = negative = 0; },
    process(probability) {
      if (!speaking) {
        positive = probability >= .65 ? positive + 1 : 0;
        if (positive >= 3) { speaking = true; negative = 0; return 'speech_started'; }
      } else {
        negative = probability < .35 ? negative + 1 : 0;
        if (negative >= 8) { speaking = false; positive = 0; return 'speech_stopped'; }
      }
      return null;
    },
  };
}
