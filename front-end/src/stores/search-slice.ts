import type { SearchSlice, SliceCreator } from "./types";
export const createSearchSlice: SliceCreator<SearchSlice> = (set) => ({
  filters: {},
  sort: "recommended",
  searchRevision: 0,
  setFilters: (patch) =>
    set((s) => ({
      filters: { ...s.filters, ...patch },
      searchRevision: s.searchRevision + 1,
      resultSetId: undefined,
    })),
  replaceFilters: (filters) =>
    set((s) => ({
      filters,
      searchRevision: s.searchRevision + 1,
      resultSetId: undefined,
    })),
  setSort: (sort) => set({ sort }),
});
