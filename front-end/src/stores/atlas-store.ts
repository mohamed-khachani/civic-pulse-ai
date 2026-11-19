import { create } from "zustand";
import { createSearchSlice } from "./search-slice";
import { createMapSlice } from "./map-slice";
import { createConversationSlice } from "./conversation-slice";
import { createUiSlice } from "./ui-slice";
import type { AtlasState } from "./types";
/** Four focused slices, composed in one store so cross-slice updates remain atomic. */
export const useAtlas = create<AtlasState>((...args) => ({
  ...createSearchSlice(...args),
  ...createMapSlice(...args),
  ...createConversationSlice(...args),
  ...createUiSlice(...args),
}));
