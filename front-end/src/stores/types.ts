import type { StateCreator } from "zustand";
import type {
  ChatMessage,
  ChatResponse,
  ListingSearchFilters,
  MapAction,
  MapViewport,
  SortOrder,
} from "@/types";
export interface SearchSlice {
  filters: ListingSearchFilters;
  sort: SortOrder;
  searchRevision: number;
  resultSetId?: string;
  setFilters: (patch: Partial<ListingSearchFilters>) => void;
  replaceFilters: (filters: ListingSearchFilters) => void;
  setSort: (sort: SortOrder) => void;
}
export interface MapSlice {
  selectedId?: string;
  viewport: MapViewport;
  mapAction?: MapAction;
  mapActionVersion: number;
  fittedResultKey?: string;
  visibleLayers: string[];
  censusVisible: boolean;
  listingsVisible: boolean;
  setListingsVisible: (visible: boolean) => void;
  activeCensusMetric?: string;
  selectedCensusId?: string;
  setCensusVisible: (visible: boolean) => void;
  setCensusMetric: (id?: string) => void;
  selectCensus: (id?: string) => void;
  select: (id?: string) => void;
  setViewport: (viewport: MapViewport) => void;
  act: (action: MapAction) => void;
  toggleLayer: (id: string) => void;
}
export interface ConversationSlice {
  conversationId?: string;
  messages: ChatMessage[];
  pending: boolean;
  suggestions: string[];
  updateMessage: (id: string, content: string) => void;
  addMessage: (message: ChatMessage) => void;
  setPending: (pending: boolean) => void;
  applyChat: (
    revision: number,
    data: Pick<
      ChatResponse,
      | "filters"
      | "filters_mode"
      | "conversation_id"
      | "result_set_id"
      | "suggestions"
      | "map_action"
    >,
  ) => boolean;
}
export interface UiSlice {
  mode: "chat" | "map";
  detailsId?: string;
  setMode: (mode: "chat" | "map") => void;
  openDetails: (id?: string) => void;
}
export type AtlasState = SearchSlice & MapSlice & ConversationSlice & UiSlice;
export type SliceCreator<T> = StateCreator<AtlasState, [], [], T>;
