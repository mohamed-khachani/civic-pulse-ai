"use client";
import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
export function LoadingStatus({
  title = "Buscando viviendas",
  detail = "Estamos consultando los resultados que encajan contigo.",
  compact = false,
}: {
  title?: string;
  detail?: string;
  compact?: boolean;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - start) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
  return (
    <div
      className={`loading-status ${compact ? "loading-status-compact" : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className="loading-status-copy">
        <span className="loading-status-icon">
          <LoaderCircle size={18} className="spin" />
        </span>
        <div>
          <strong>{title}…</strong>
          <p>
            {elapsed >= 10
              ? "La consulta está tardando un poco más. Seguimos trabajando en ella."
              : detail}
          </p>
        </div>
        <span className="loading-elapsed" aria-hidden="true">
          {elapsed}s
        </span>
      </div>
      <div className="loading-track" aria-hidden="true">
        <span />
      </div>
    </div>
  );
}
