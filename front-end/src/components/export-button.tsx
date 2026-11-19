"use client";
import { useState } from "react";
import { Download, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { useAtlas } from "@/stores/atlas-store";
import { useListings } from "@/hooks/use-listings";
import { Button } from "./ui/button";
export function ExportButton() {
  const [loading, setLoading] = useState(false);
  const { data } = useListings();
  async function run() {
    setLoading(true);
    try {
      const s = useAtlas.getState();
      let blob = await api.export(s.filters, s.sort, undefined, s.resultSetId);
      const text = await blob.text();
      blob = new Blob([text.startsWith("\uFEFF") ? "" : "\uFEFF", text], {
        type: "text/csv;charset=utf-8",
      });
      downloadCsv(blob);
      toast.success("CSV exportado con todas las viviendas de tu búsqueda.");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "No se ha podido exportar el CSV.",
      );
    } finally {
      setLoading(false);
    }
  }
  return (
    <Button
      variant="outline"
      className="export-button"
      aria-label={loading ? "Exportando CSV" : "Exportar CSV"}
      onClick={run}
      disabled={loading || !data?.total}
    >
      {loading ? (
        <LoaderCircle size={16} className="spin" />
      ) : (
        <Download size={16} />
      )}
      <span>{loading ? "Exportando…" : "Exportar CSV"}</span>
    </Button>
  );
}
