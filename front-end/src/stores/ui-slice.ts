import type { UiSlice, SliceCreator } from "./types";
export const createUiSlice: SliceCreator<UiSlice> = (set) => ({
  mode: "chat",
  setMode: (mode) => set({ mode }),
  openDetails: (detailsId) =>
    set({ detailsId, ...(detailsId ? { selectedId: detailsId } : {}) }),
});
