"use client";
import { useEffect, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAtlas } from "@/stores/atlas-store";
export function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
export function useListings(page = 1) {
  const currentFilters = useAtlas((s) => s.filters);
  const filters = useDebounced(currentFilters);
  const sort = useAtlas((s) => s.sort);
  const resultSetId = useAtlas((s) => s.resultSetId);
  const pending = useAtlas((s) => s.pending);
  const query = useQuery({
    enabled: !pending,
    placeholderData: keepPreviousData,
    queryKey: ["listings", filters, sort, page, resultSetId],
    queryFn: ({ signal }) =>
      api.listings(filters, sort, page, signal, resultSetId),
  });
  return { ...query, filtersReady: filters === currentFilters };
}
export function useGeo() {
  const currentFilters = useAtlas((s) => s.filters);
  const filters = useDebounced(currentFilters);
  const resultSetId = useAtlas((s) => s.resultSetId);
  const pending = useAtlas((s) => s.pending);
  const query = useQuery({
    enabled: !pending,
    placeholderData: keepPreviousData,
    queryKey: ["geo", filters, resultSetId],
    queryFn: ({ signal }) => api.geo(filters, signal, resultSetId),
  });
  return { ...query, filtersReady: filters === currentFilters };
}
export function useOptions() {
  return useQuery({
    queryKey: ["options"],
    queryFn: ({ signal }) => api.options(signal),
    staleTime: Infinity,
  });
}
