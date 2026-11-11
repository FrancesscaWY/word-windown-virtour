import { mountWelcomeSwipe } from './arrival/navigation.js';
import { mountPageTransitions, mountMascotGreeting } from './arrival/presentation.js';

const page = document.querySelector('#welcome-page');
const entrance = document.querySelector('#welcome-enter');
const transitions = mountPageTransitions(document.body);
const disposeSwipe = mountWelcomeSwipe(page, () => transitions.go(entrance.href));
const disposeGreeting = mountMascotGreeting(document.querySelector('.welcome-guide'), document.querySelector('#welcome-message'));
window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  disposeSwipe(); disposeGreeting(); transitions.dispose();
});
