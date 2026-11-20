"use client";
import type { ReactNode } from "react";
import { useAtlas } from "@/stores/atlas-store";

export function ListingLink({ id, url, children, className, label }: {
  id: string;
  url?: string | null;
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return url && /^https?:\/\//i.test(url)
    ? <a href={url} target="_blank" rel="noopener noreferrer" className={className} aria-label={label}>{children}</a>
    : <button className={className} aria-label={label} onClick={() => useAtlas.getState().openDetails(id)}>{children}</button>;
}
