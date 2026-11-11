import { icon } from './icons.js';
import { locatedPois, toCoordinates, distanceMeters } from '../guide/location.js';

/** Run the demo route locally; the visitor only needs the companion pause control. */
export function mountSimulator({ container, onPosition, onSource, onToggleCompanion, scope = globalThis }) {
  container.innerHTML = `<header><button type="button" data-companion-toggle class="icon-button" aria-label="暂停伴游" title="暂停伴游" aria-pressed="false">${icon('pause')}</button></header><output class="location-readout sr-only" aria-live="off">模拟定位</output>`;
  const button = container.querySelector('[data-companion-toggle]');
  button.addEventListener('click', onToggleCompanion);
  const route = ['liberty', 'pyramid', 'eiffel', 'arc', 'sydney'].map(id => locatedPois.find(poi => poi.id === id)).filter(Boolean);
  const lengths = route.slice(1).map((poi, index) => distanceMeters(toCoordinates(route[index].position), toCoordinates(poi.position)));
  let active = false, paused = false, progress = 0, timer = null, lastTime = 0;
  const stop = () => { if (timer !== null) scope.clearInterval(timer); timer = null; };
  const emit = () => {
    if (route.length < 2) return;
    const segment = Math.min(route.length - 2, Math.floor(progress));
    const fraction = progress - segment, a = route[segment].position, b = route[segment + 1].position;
    onPosition({ ...toCoordinates({ x:a.x + (b.x - a.x) * fraction, y:a.y + (b.y - a.y) * fraction }), accuracy:5 }, '模拟定位');
  };
  const start = () => {
    if (!active || paused || timer !== null || route.length < 2 || progress >= route.length - 1) return;
    lastTime = scope.Date.now();
    timer = scope.setInterval(() => {
      const now = scope.Date.now();
      // A throttled background tab must not jump across the park on resuming.
      let remaining = Math.max(0, Math.min(now - lastTime, 1000)) / 1000 * 1.4 * 5;
      lastTime = now;
      while (remaining > 0 && progress < route.length - 1) {
        const segment = Math.floor(progress), available = (1 - (progress - segment)) * lengths[segment];
        if (remaining >= available) { progress = segment + 1; remaining -= available; }
        else { progress += remaining / lengths[segment]; remaining = 0; }
      }
      emit();
      if (progress >= route.length - 1) stop();
    }, 250);
  };
  return {
    setPaused(value) {
      paused = Boolean(value);
      button.innerHTML = icon(paused ? 'pin' : 'pause');
      button.setAttribute('aria-pressed', String(paused));
      button.setAttribute('aria-label', paused ? '恢复伴游' : '暂停伴游');
      button.title = paused ? '恢复伴游' : '暂停伴游';
      if (paused) stop(); else start();
    },
    setActive(value) {
      if (active === Boolean(value)) return;
      active = Boolean(value); container.hidden = !active; stop();
      if (!active) return;
      progress = 0; onSource?.('simulated'); emit(); start();
    },
    dispose() { active = false; stop(); button.removeEventListener('click', onToggleCompanion); },
  };
}
