import type { Listing } from "@/types";
export const csvColumns = [
  "id",
  "source",
  "url",
  "title",
  "description",
  "price",
  "surface_m2",
  "bedrooms",
  "bathrooms",
  "latitude",
  "longitude",
  "district",
  "neighborhood",
  "furnished",
  "elevator",
  "parking",
  "air_conditioning",
  "terrace",
  "compatibility_score",
] as const;
export function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (typeof value === "string" && /^[=+@\-\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
export function toCsv(listings: Listing[]): string {
  return (
    "\uFEFF" +
    [
      csvColumns.join(","),
      ...listings.map((l) =>
        csvColumns
          .map((k) =>
            escapeCsv(
              k === "compatibility_score" ? l.compatibility?.score : l[k],
            ),
          )
          .join(","),
      ),
    ].join("\r\n")
  );
}
export function downloadCsv(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `atlas-madrid-listings-${new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" })}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
