import './main.js';
import { store } from './guide/store.js';
import { tourModeFromSearch } from './arrival/navigation.js';

// Reuse the existing mode controller, including its capture cancellation and
// companion simulator setup, without changing the shared experience module.
const requestedMode = tourModeFromSearch(location.search);
if (requestedMode !== store.get().tourMode) {
  document.querySelector(`#mode-menu [data-tour-mode="${requestedMode}"]`)?.click();
}

// Replacing the address keeps browser Back pointing to the mode-selection page.
store.subscribe(state => {
  document.body.dataset.page = state.view === 'panorama' ? 'panorama' : 'main';
  const address = new URL(location.href);
  if (address.searchParams.get('mode') === state.tourMode) return;
  address.searchParams.set('mode', state.tourMode);
  history.replaceState(history.state, '', address);
});
