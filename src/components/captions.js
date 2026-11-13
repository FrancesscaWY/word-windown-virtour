/** Sentence cues follow actual narration playback; audio without cues retains the full caption. */
export function captionParts(text, charIndex) {
  if (!Number.isFinite(charIndex) || charIndex < 0) return { before: '', current: '', after: text };
  const sentences = [...String(text).matchAll(/[^。！？!?；;]+[。！？!?；;]?/g)];
  const part = sentences.find(item => charIndex >= item.index && charIndex < item.index + item[0].length);
  return part ? { before: text.slice(0, part.index), current: part[0], after: text.slice(part.index + part[0].length) } : { before: '', current: '', after: text };
}
