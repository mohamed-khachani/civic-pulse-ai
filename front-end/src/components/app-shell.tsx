"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Map, MessageSquare, MapPin, Info } from "lucide-react";
import { useAtlas } from "@/stores/atlas-store";
import { Logo } from "./logo";
import { ExportButton } from "./export-button";
import { ChatPanel } from "./chat/chat-panel";
import { ListingDetails } from "./listings/listing-details";
import { isMock } from "@/lib/api";
import { Popover } from "./ui/popover";
import { Button } from "./ui/button";
const MadridMap = dynamic(() => import("./map/madrid-map"), {
  ssr: false,
  loading: () => (
    <div className="map-loading skeleton">
      <Map size={30} />
      <span>Cargando Madrid…</span>
    </div>
  ),
});
export function AppShell() {
  const mode = useAtlas((s) => s.mode);
  const setMode = useAtlas((s) => s.setMode);
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Saltar al contenido
      </a>
      <header className="header">
        <Link href="/" className="brand" aria-label="Atlas, inicio">
          <Logo />
        </Link>
        <span className="header-divider" />
        <nav className="mode-switch" aria-label="Modo de exploración">
          <button
            onClick={() => setMode("chat")}
            aria-current={mode === "chat" ? "page" : undefined}
            className={mode === "chat" ? "active" : ""}
          >
            <MessageSquare size={16} />
            <span>Conversación</span>
          </button>
          <button
            onClick={() => setMode("map")}
            aria-current={mode === "map" ? "page" : undefined}
            className={mode === "map" ? "active" : ""}
          >
            <Map size={16} />
            <span>Explorar mapa</span>
          </button>
        </nav>
        <div className="header-right">
          <span className="city-label">
            <MapPin size={14} />
            Madrid, España
          </span>
          <ExportButton />
          <Popover
            label="Acerca de Atlas"
            trigger={
              <Button size="icon" variant="ghost" aria-label="Acerca de Atlas">
                <Info size={18} />
              </Button>
            }
          >
            <strong>Tu búsqueda, conectada.</strong>
            <p>
              Describe lo que buscas, ajusta los filtros y explora el mismo
              resultado en el mapa.
            </p>
            <p>
              {isMock
                ? "Modo demostración: viviendas sintéticas e imágenes ilustrativas. No son anuncios reales."
                : "Los datos proceden de la API configurada."}
            </p>
          </Popover>
        </div>
      </header>
      <div className="demo-banner">
        {isMock ? (
          <>
            <span className="demo-badge">DEMO</span>Explora Atlas con viviendas
            de ejemplo.{" "}
            <span className="banner-extra">
              Los anuncios y las imágenes son ilustrativos.
            </span>
          </>
        ) : (
          <>
            <MapPin size={13} />
            Tu próximo hogar empieza en Madrid.
          </>
        )}
      </div>
      <main
        id="main"
        className={`workspace ${mode === "map" ? "map-mode" : "chat-mode"}`}
      >
        {mode === "map" && (
          <section
            className="map-workspace"
            aria-label="Mapa de viviendas de Madrid"
          >
            <MadridMap />
          </section>
        )}
        <section
          className="conversation-workspace"
          aria-label="Asistente de búsqueda"
        >
          <ChatPanel compact={mode === "map"} />
        </section>
      </main>
      <ListingDetails />
    </div>
  );
}
