import { getPoi, getHotspot } from '../data/pois.js';

/** Explicit UI operations; language/Agent dispatch will use these same actions later. */
export function createTourActions(store, beforeSceneChange = () => {}) {
  return {
    selectPoi(id) {
      if (!getPoi(id)) return false;
      if (store.get().selectedPoiId !== id) {
        beforeSceneChange();
        store.set({ selectedPoiId: id, view: 'map', detailsOpen: false, activeHotspotId: null });
      }
      return true;
    },
    enterPanorama(id = store.get().selectedPoiId) {
      const poi = getPoi(id);
      if (!poi) return false;
      beforeSceneChange();
      if (!poi.panorama && !poi.photo) {
        store.set({ selectedPoiId: id, view: 'map', detailsOpen: false, activeHotspotId: null });
        return false;
      }
      store.set({ selectedPoiId: id, view: poi.panorama ? 'panorama' : 'photo', detailsOpen: false, activeHotspotId: null });
      return true;
    },
    showMap() {
      beforeSceneChange();
      store.set({ view: 'map', detailsOpen: false, activeHotspotId: null });
    },
    showDetails(hotspotId = null) {
      if (hotspotId && !getHotspot(store.get().selectedPoiId, hotspotId)) return false;
      store.set({ detailsOpen: false, activeHotspotId: hotspotId });
      return true;
    },
    closeDetails() { store.set({ detailsOpen: false, activeHotspotId: null }); },
  };
}
