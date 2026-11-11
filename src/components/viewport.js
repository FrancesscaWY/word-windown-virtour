/** Keep the whole application inside the visible viewport, including an on-screen keyboard. */
export function mountViewport(root, scope = globalThis) {
  const visual = scope.visualViewport;
  let frame = null;
  let disposed = false;
  const update = () => {
    frame = null;
    if (disposed) return;
    const height = visual?.height || scope.innerHeight || 720;
    const top = visual?.offsetTop || 0;
    root.style.setProperty('--viewport-height', `${Math.round(height)}px`);
    root.style.setProperty('--viewport-top', `${Math.round(top)}px`);
    root.dataset.compact = String(height < 500);
    root.dataset.constrained = String(height < 320);
  };
  const schedule = () => {
    if (disposed || frame !== null) return;
    if (scope.requestAnimationFrame) frame = scope.requestAnimationFrame(update);
    else update();
  };
  const targets = [[scope, 'resize'], [scope, 'orientationchange'], [scope, 'pageshow'], [scope, 'focusout']];
  if (visual) targets.push([visual, 'resize'], [visual, 'scroll']);
  for (const [target, event] of targets) target.addEventListener(event, schedule);
  update();
  return () => {
    if (disposed) return;
    disposed = true;
    if (frame !== null) scope.cancelAnimationFrame?.(frame);
    for (const [target, event] of targets) target.removeEventListener(event, schedule);
    root.style.removeProperty('--viewport-height'); root.style.removeProperty('--viewport-top');
    delete root.dataset.compact;
    delete root.dataset.constrained;
  };
}
