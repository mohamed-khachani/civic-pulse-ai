export const CENSUS_HOVER_DELAY_MS = 5000;
export const CENSUS_DETAIL_MIN_ZOOM = 14;
export interface CensusHoverPosition {
  id: string;
  longitude: number;
  latitude: number;
}
/** Dwell is measured per section, not per mousemove. Every interruption cancels the pending callback. */
export function createCensusHoverIntent(
  show: (position: CensusHoverPosition) => void,
  hide: () => void,
) {
  let candidate: CensusHoverPosition | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let shown = false;
  function cancel() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    candidate = undefined;
    if (shown) hide();
    shown = false;
  }
  return {
    cancel,
    update(position: CensusHoverPosition | undefined, zoom: number) {
      if (!position || zoom < CENSUS_DETAIL_MIN_ZOOM) {
        cancel();
        return;
      }
      if (candidate?.id === position.id) {
        candidate = position;
        if (shown) show(position);
        return;
      }
      cancel();
      candidate = position;
      timer = setTimeout(() => {
        timer = undefined;
        if (candidate) {
          shown = true;
          show(candidate);
        }
      }, CENSUS_HOVER_DELAY_MS);
    },
  };
}
