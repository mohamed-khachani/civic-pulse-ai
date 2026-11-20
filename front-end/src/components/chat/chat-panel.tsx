"use client";
import { useEffect, useRef } from "react";
import { Map, MapPin, X, MessageSquare } from "lucide-react";
import { useAtlas } from "@/stores/atlas-store";
import { useChat } from "@/hooks/use-chat";
import { Welcome } from "./welcome";
import { ChatInput } from "./chat-input";
import { ListingList } from "@/components/listings/listing-list";
import { Logo } from "../logo";
import { Button } from "../ui/button";
import { LoadingStatus } from "../ui/loading-status";
import { WaitingListing } from "./waiting-listing";
export function ChatPanel({ compact }: { compact: boolean }) {
  const messages = useAtlas((s) => s.messages);
  const pending = useAtlas((s) => s.pending);
  const suggestions = useAtlas((s) => s.suggestions);
  const selectedId = useAtlas((s) => s.selectedId);
  const bottom = useRef<HTMLDivElement>(null);
  const { mutate } = useChat();
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages, pending]);
  if (!compact && !messages.length) return <Welcome />;
  return (
    <div className={`chat-panel ${compact ? "compact" : ""}`}>
      <div className="panel-heading">
        <div>
          <Logo wordmark={false} />
          <div>
            <h2>Tu próximo hogar</h2>
            <p>Lo encontramos contigo.</p>
          </div>
        </div>
        {compact ? (
          <span className="panel-tag">MADRID</span>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => useAtlas.getState().setMode("map")}
          >
            <Map size={15} />
            Ver en el mapa
          </Button>
        )}
      </div>
      <div className="chat-scroll">
        {!messages.length && (
          <div className="map-chat-intro">
            <span className="intro-icon">
              <MessageSquare size={22} />
            </span>
            <h3>Madrid tiene un lugar para ti.</h3>
            <p>
              ¿Un piso con terraza? ¿Dos habitaciones y menos de 1.200 €?
              Cuéntame qué necesitas.
            </p>
            <button
              onClick={() =>
                mutate("Busco un piso de 2 habitaciones por menos de 1.200 €")
              }
            >
              2 habitaciones · hasta 1.200 €
            </button>
          </div>
        )}
        <div className="messages" aria-live="polite" aria-busy={pending}>
          {messages.map((message) => (
            <div key={message.id} className={`message ${message.role}`}>
              {message.role === "assistant" && (
                <span className="assistant-label">
                  <Logo wordmark={false} />
                  ATLAS
                </span>
              )}
              <p>{message.content}</p>
            </div>
          ))}
          {pending && (
            <>
            <LoadingStatus
              title="Atlas está buscando tu próximo hogar"
              detail="Estamos procesando tus criterios y consultando las viviendas. Los resultados aparecerán aquí y en el mapa."
            />
            <WaitingListing />
            </>
          )}
          <div ref={bottom} />
        </div>
        {!pending && suggestions.length > 0 && (
          <div className="follow-ups">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() =>
                  s === "Ver en el mapa"
                    ? (useAtlas.getState().setMode("map"),
                      useAtlas.getState().act({ type: "fit_results" }))
                    : mutate(s)
                }
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {!pending && <ListingList compact={compact} />}
      </div>
      <div className="chat-input-area">
        {selectedId && (
          <div className="selection-context">
            <MapPin size={13} />
            <button onClick={() => useAtlas.getState().openDetails(selectedId)}>
              Vivienda seleccionada como contexto
            </button>
            <button
              aria-label="Quitar selección"
              onClick={() => useAtlas.getState().select(undefined)}
            >
              <X size={13} />
            </button>
          </div>
        )}
        <ChatInput />
        <p className="input-footnote">
          Los trayectos son estimaciones de IA; comprueba las líneas y los horarios antes de viajar.
        </p>
      </div>
    </div>
  );
}
