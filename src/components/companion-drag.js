/** Keep the character's top-left position within its available screen bounds. */
export function clampCompanionPosition(position, bounds) {
  const left = Number.isFinite(bounds?.left) ? bounds.left : 0;
  const top = Number.isFinite(bounds?.top) ? bounds.top : 0;
  const right = Number.isFinite(bounds?.right) ? Math.max(left, bounds.right) : left;
  const bottom = Number.isFinite(bounds?.bottom) ? Math.max(top, bounds.bottom) : top;
  const x = Number.isFinite(position?.x) ? position.x : left;
  const y = Number.isFinite(position?.y) ? position.y : top;
  return { x: Math.max(left, Math.min(right, x)), y: Math.max(top, Math.min(bottom, y)) };
}

/** Drag a character without turning the release into a replay click. */
export function mountCompanionDrag({ element, getPosition, onMove, onPlace }) {
  const view = element.ownerDocument?.defaultView ?? element;
  const listeners = [];
  const previousTouchAction = element.style.touchAction;
  let gesture = null;
  let suppressClick = false;
  let disposed = false;
  element.style.touchAction = 'none';

  const listen = (target, name, handler, options) => {
    target.addEventListener(name, handler, options);
    listeners.push(() => target.removeEventListener(name, handler, options));
  };
  const releaseCapture = pointerId => {
    try {
      if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
    } catch { /* The browser may already have cancelled this pointer. */ }
  };
  const finish = (event, notify = true) => {
    if (!gesture || (event?.pointerId !== undefined && event.pointerId !== gesture.pointerId)) return;
    const previous = gesture;
    gesture = null;
    delete element.dataset.dragging;
    // Clear the gesture before release; lostpointercapture can fire synchronously.
    releaseCapture(previous.pointerId);
    if (previous.dragging && notify) {
      suppressClick = true;
      onPlace();
    }
  };

  listen(element, 'pointerdown', event => {
    if (disposed || gesture || event.button !== 0 || event.isPrimary === false) return;
    const position = getPosition();
    gesture = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: position.x, y: position.y, dragging: false };
    suppressClick = false;
    try { element.setPointerCapture(event.pointerId); } catch { /* Window listeners still complete the gesture. */ }
  });
  listen(view, 'pointermove', event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const dx = event.clientX - gesture.clientX;
    const dy = event.clientY - gesture.clientY;
    if (!gesture.dragging && Math.hypot(dx, dy) <= 6) return;
    gesture.dragging = true;
    element.dataset.dragging = 'true';
    event.preventDefault();
    onMove(clampCompanionPosition({ x: gesture.x + dx, y: gesture.y + dy }, getPosition().bounds));
  }, { passive: false });
  listen(view, 'pointerup', finish);
  listen(view, 'pointercancel', finish);
  listen(element, 'lostpointercapture', event => {
    if (event.target === element) finish(event);
  });
  listen(view, 'blur', () => finish());
  listen(element, 'click', event => {
    // Keyboard activation has detail 0 and must remain available after a drag.
    if (!suppressClick || event.detail === 0) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  listen(element, 'keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!direction) return;
    event.preventDefault();
    const position = getPosition();
    const step = event.shiftKey ? 32 : 16;
    onMove(clampCompanionPosition({ x: position.x + direction[0] * step, y: position.y + direction[1] * step }, position.bounds));
    onPlace();
  });

  return () => {
    if (disposed) return;
    disposed = true;
    listeners.forEach(remove => remove());
    finish(undefined, false);
    element.style.touchAction = previousTouchAction;
  };
}
