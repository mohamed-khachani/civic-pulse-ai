"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAtlas } from "@/stores/atlas-store";
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

export function useCensusSection(id: string, interaction: "hover" | "click") {
  const metric = useAtlas((s) => s.activeCensusMetric);
  return useQuery({
    queryKey: ["census-section", id, interaction, metric],
    queryFn: ({ signal }) => {
      console.log(
        "[Atlas] census section reached",
        JSON.stringify({
          section_id: id,
          interaction,
          metric,
        }),
      );
      return api.censusSection(id, interaction, metric, signal);
    },
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });
}
