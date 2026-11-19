import { z } from "zod";
import {
  geographicLayerSchema,
  censusCollectionSchema,
  censusMetricSchema,
  censusSectionInfoSchema,
  geoResponseSchema,
  listingSchema,
  optionsSchema,
  searchResponseSchema,
  type ChatRequest,
  type ListingSearchFilters,
  type SortOrder,
} from "@/types";
import { endpoints, json, request } from "./client";
import { readChatResponse } from "./chat";
import { serializeFilters } from "@/lib/search";
export { isMock } from "./client";
export const api = {
  census: (signal?: AbortSignal) =>
    json(endpoints.census, censusCollectionSchema, { signal }),
  censusMetrics: (signal?: AbortSignal) =>
    json(endpoints.censusMetrics, z.array(censusMetricSchema), { signal }),
  censusSection: (
    id: string,
    interaction: "hover" | "click",
    metric: string | undefined,
    signal?: AbortSignal,
  ) =>
    json(
      `${endpoints.censusSection(id)}?${new URLSearchParams({ interaction, ...(metric ? { metric } : {}) })}`,
      censusSectionInfoSchema,
      { signal },
    ),
  listings: async (
    f: ListingSearchFilters,
    s: SortOrder,
    p = 1,
    signal?: AbortSignal,
    resultSetId?: string,
  ) =>
    json(
      `${endpoints.listings}?${serializeFilters(f, { sort: s, page: p, page_size: 8, result_set_id: resultSetId })}`,
      searchResponseSchema,
      { signal },
    ),
  detail: async (id: string, signal?: AbortSignal) =>
    json(endpoints.detail(id), listingSchema, { signal }),
  geo: async (
    f: ListingSearchFilters,
    signal?: AbortSignal,
    resultSetId?: string,
  ) =>
    json(
      `${endpoints.geo}?${serializeFilters(f, { result_set_id: resultSetId })}`,
      geoResponseSchema,
      { signal },
    ),
  options: async (signal?: AbortSignal) =>
    json(endpoints.options, optionsSchema, { signal }),
  layers: async (signal?: AbortSignal) =>
    json(endpoints.layers, z.array(geographicLayerSchema), { signal }),
  chat: async (
    data: ChatRequest,
    signal?: AbortSignal,
    onDelta?: (text: string) => void,
  ) =>
    readChatResponse(
      await request(endpoints.chat, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(data),
        signal,
      }),
      onDelta,
    ),
  export: async (
    f: ListingSearchFilters,
    s: SortOrder,
    signal?: AbortSignal,
    resultSetId?: string,
  ) =>
    (
      await request(
        `${endpoints.export}?${serializeFilters(f, { sort: s, result_set_id: resultSetId })}`,
        { signal, headers: { Accept: "text/csv" } },
      )
    ).blob(),
};
