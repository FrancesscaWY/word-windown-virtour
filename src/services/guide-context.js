/** Follow-up requests need the visit order, not thousands of road coordinates. */
export function guideRequestContext(state) {
  const stops = Array.isArray(state?.plannedRoute?.stops)
    ? state.plannedRoute.stops.slice(0, 12).filter(stop => typeof stop?.poiId === 'string').map(stop => ({ poiId: stop.poiId })) : [];
  return {
    messages: state?.messages, selectedPoiId: state?.selectedPoiId, mentionedPoiId: state?.mentionedPoiId, view: state?.view,
    plannedRoute: stops.length ? { stops } : null,
  };
}
