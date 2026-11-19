export const CENSUS_DETAIL_MIN_ZOOM = 14;
export interface CensusHoverPosition {
  id: string;
  longitude: number;
  latitude: number;
}
/** Immediate geographic hover; zoom and listing priority are the only gates. */
export function createCensusHoverIntent(
  show: (position: CensusHoverPosition) => void,
  hide: () => void,
) {
  let shown = false;
  function cancel() {
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
      shown = true;
      show(position);
    },
  };
}
