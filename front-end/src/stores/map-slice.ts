import type { MapSlice, SliceCreator } from "./types";
export const createMapSlice: SliceCreator<MapSlice> = (set) => ({
  viewport: { latitude: 40.4168, longitude: -3.7038, zoom: 11.7 },
  mapActionVersion: 0,
  visibleLayers: [],
  select: (selectedId) => set({ selectedId }),
  setViewport: (viewport) => set({ viewport }),
  act: (mapAction) =>
    set((s) => ({ mapAction, mapActionVersion: s.mapActionVersion + 1 })),
  toggleLayer: (id) =>
    set((s) => ({
      visibleLayers: s.visibleLayers.includes(id)
        ? s.visibleLayers.filter((x) => x !== id)
        : [...s.visibleLayers, id],
    })),
});
