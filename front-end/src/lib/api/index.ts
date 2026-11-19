import { z } from "zod";
import {
  geographicLayerSchema,
  geoResponseSchema,
  listingSchema,
  optionsSchema,
  searchResponseSchema,
  type ChatRequest,
  type ListingSearchFilters,
  type SortOrder,
} from "@/types";
import { isMock, endpoints, json, request } from "./client";
import { readChatResponse } from "./chat";
import { serializeFilters } from "@/lib/search";
export { isMock };
const mock = () => import("@/lib/mock/adapter").then((m) => m.mockApi);
export const api = {
  listings: async (
    f: ListingSearchFilters,
    s: SortOrder,
    p = 1,
    signal?: AbortSignal,
    resultSetId?: string,
  ) =>
    isMock
      ? (await mock()).listings(f, s, p, signal)
      : json(
          `${endpoints.listings}?${serializeFilters(f, { sort: s, page: p, page_size: 8, result_set_id: resultSetId })}`,
          searchResponseSchema,
          { signal },
        ),
  detail: async (id: string, signal?: AbortSignal) =>
    isMock
      ? (await mock()).detail(id, signal)
      : json(endpoints.detail(id), listingSchema, { signal }),
  geo: async (
    f: ListingSearchFilters,
    signal?: AbortSignal,
    resultSetId?: string,
  ) =>
    isMock
      ? (await mock()).geo(f, signal)
      : json(
          `${endpoints.geo}?${serializeFilters(f, { result_set_id: resultSetId })}`,
          geoResponseSchema,
          { signal },
        ),
  options: async (signal?: AbortSignal) =>
    isMock
      ? (await mock()).options(signal)
      : json(endpoints.options, optionsSchema, { signal }),
  layers: async (signal?: AbortSignal) =>
    isMock
      ? (await mock()).layers(signal)
      : json(endpoints.layers, z.array(geographicLayerSchema), { signal }),
  chat: async (
    data: ChatRequest,
    signal?: AbortSignal,
    onDelta?: (text: string) => void,
  ) =>
    isMock
      ? (await mock()).chat(data, signal)
      : readChatResponse(
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
    isMock
      ? (await mock()).export(f, s, signal)
      : (
          await request(
            `${endpoints.export}?${serializeFilters(f, { sort: s, result_set_id: resultSetId })}`,
            { signal, headers: { Accept: "text/csv" } },
          )
        ).blob(),
};
