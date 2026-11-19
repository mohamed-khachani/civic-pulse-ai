"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
export function useCensus(enabled = true) {
  return useQuery({
    queryKey: ["census"],
    queryFn: ({ signal }) => api.census(signal),
    enabled,
    staleTime: Infinity,
  });
}
export function useCensusMetrics(enabled = true) {
  return useQuery({
    queryKey: ["census-metrics"],
    queryFn: ({ signal }) => api.censusMetrics(signal),
    enabled,
    staleTime: 300000,
  });
}
