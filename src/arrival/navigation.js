export const TOUR_MODES = Object.freeze(['interactive', 'immersive', 'companion']);

/** A page address may choose an existing mode, never inject a control selector. */
export function tourModeFromSearch(search = '') {
  const value = new URLSearchParams(search).get('mode');
  return TOUR_MODES.includes(value) ? value : 'interactive';
}

/** The mode-selection page may opt into one fresh-entry presentation only. */
export function isModeSelectionEntry(search = '') {
  return new URLSearchParams(search).get('entry') === 'modes';
}

/** Horizontal intent only: scrolling and small taps must never leave the page. */
export function isWelcomeSwipe(start, end) {
  if (!start || !end) return false;
  const dx = end.x - start.x, dy = end.y - start.y;
  const elapsed = end.time - start.time;
  return Number.isFinite(dx) && Number.isFinite(dy) && elapsed >= 0 && elapsed < 1400 && dx <= -65 && Math.abs(dx) > Math.abs(dy) * 1.6;
}

export function mountWelcomeSwipe(element, navigate) {
  let start = null;
  const down = event => {
    if (event.isPrimary === false || event.button !== 0 || event.target.closest?.('a, button, input, select, textarea')) return;
    start = { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp };
  };
  const up = event => {
    if (!start || event.pointerId !== start.id) return;
    const origin = start; start = null;
    if (isWelcomeSwipe(origin, { x: event.clientX, y: event.clientY, time: event.timeStamp })) navigate();
  };
  const cancel = () => { start = null; };
  element.addEventListener('pointerdown', down);
  element.addEventListener('pointerup', up);
  element.addEventListener('pointercancel', cancel);
  element.addEventListener('lostpointercapture', cancel);
  return () => {
    element.removeEventListener('pointerdown', down);
    element.removeEventListener('pointerup', up);
    element.removeEventListener('pointercancel', cancel);
    element.removeEventListener('lostpointercapture', cancel);
  };
}
