import { mountPageTransitions, mountCardDepth } from './arrival/presentation.js';

const transitions = mountPageTransitions(document.body);
const disposeDepth = mountCardDepth(document.querySelectorAll('.arrival-mode-card'));
window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  disposeDepth(); transitions.dispose();
});
