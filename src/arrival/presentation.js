/** Enhance native links only. Modified clicks, downloads and other origins stay native. */
export function isArrivalNavigation(event, link, currentHref) {
  if (!link || event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (link.hasAttribute('download') || (link.target && link.target !== '_self')) return false;
  try {
    const target = new URL(link.href, currentHref);
    const current = new URL(currentHref);
    return /^https?:$/.test(target.protocol) && target.origin === current.origin &&
      !(target.pathname === current.pathname && target.search === current.search && target.hash);
  } catch { return false; }
}

/** A short exit cannot queue two navigations or strand a page restored from bfcache. */
export function mountPageTransitions(root, { host = window, navigate = href => host.location.assign(href), duration = 260 } = {}) {
  let timer = null, pending = false, selected = null, disposed = false;
  const reset = () => {
    if (timer !== null) host.clearTimeout(timer);
    timer = null; pending = false;
    root.classList.remove('is-leaving');
    selected?.classList.remove('is-selected');
    selected = null;
  };
  const go = (href, card = null) => {
    if (disposed || pending) return false;
    pending = true;
    selected = card;
    const finish = () => {
      timer = null;
      try { navigate(href); } catch (error) { reset(); throw error; }
    };
    if (host.matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
    else {
      selected?.classList.add('is-selected');
      root.classList.add('is-leaving');
      timer = host.setTimeout(finish, duration);
    }
    return true;
  };
  const click = event => {
    const link = event.target.closest?.('a[href]');
    if (!isArrivalNavigation(event, link, host.location.href)) return;
    event.preventDefault();
    go(link.href, link.classList.contains('arrival-mode-card') ? link : null);
  };
  root.addEventListener('click', click);
  host.addEventListener('pageshow', reset);
  host.addEventListener('pagehide', reset);
  return {
    go,
    dispose() {
      disposed = true; reset();
      root.removeEventListener('click', click);
      host.removeEventListener('pageshow', reset);
      host.removeEventListener('pagehide', reset);
    },
  };
}

/** Pointer lighting is optional, bounded and computed at most once per frame. */
export function mountCardDepth(cards, host = window) {
  const cleanups = [...cards].map(card => {
    let frame = null, pointer = null;
    const reset = () => {
      if (frame !== null) host.cancelAnimationFrame(frame);
      frame = null; pointer = null;
      for (const key of ['--tilt-x', '--tilt-y', '--light-x', '--light-y']) card.style.removeProperty(key);
    };
    const move = event => {
      if (event.pointerType !== 'mouse' || !host.matchMedia('(hover: hover) and (pointer: fine)').matches || host.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      pointer = { x:event.clientX, y:event.clientY };
      if (frame !== null) return;
      frame = host.requestAnimationFrame(() => {
        frame = null;
        const rect = card.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (pointer.x - rect.left) / Math.max(rect.width, 1)));
        const y = Math.max(0, Math.min(1, (pointer.y - rect.top) / Math.max(rect.height, 1)));
        card.style.setProperty('--tilt-x', `${((.5 - y) * 5).toFixed(2)}deg`);
        card.style.setProperty('--tilt-y', `${((x - .5) * 5).toFixed(2)}deg`);
        card.style.setProperty('--light-x', `${(x * 100).toFixed(1)}%`);
        card.style.setProperty('--light-y', `${(y * 100).toFixed(1)}%`);
      });
    };
    card.addEventListener('pointermove', move);
    card.addEventListener('pointerleave', reset);
    host.addEventListener('blur', reset);
    host.addEventListener('pagehide', reset);
    return () => {
      reset();
      card.removeEventListener('pointermove', move);
      card.removeEventListener('pointerleave', reset);
      host.removeEventListener('blur', reset);
      host.removeEventListener('pagehide', reset);
    };
  });
  return () => cleanups.forEach(cleanup => cleanup());
}

export function mountMascotGreeting(button, message, host = window) {
  let timer = null, greeted = false;
  const reset = () => {
    if (timer !== null) host.clearTimeout(timer);
    timer = null;
    button.classList.remove('is-greeting');
  };
  const greet = () => {
    if (timer !== null) return;
    greeted = !greeted;
    message.textContent = greeted ? '出发吧，世界等着你！' : '这一程，陪你发现世界。';
    button.classList.add('is-greeting');
    timer = host.setTimeout(reset, 900);
  };
  button.addEventListener('click', greet);
  host.addEventListener('pagehide', reset);
  return () => { reset(); button.removeEventListener('click', greet); host.removeEventListener('pagehide', reset); };
}
