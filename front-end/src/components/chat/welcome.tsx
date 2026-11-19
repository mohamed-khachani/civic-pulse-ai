"use client";
import { motion } from "motion/react";
import {
  Wallet,
  GraduationCap,
  TrainFront,
  Trees,
  MapPin,
  ChevronRight,
  Map,
  SlidersHorizontal,
  MessageSquare,
} from "lucide-react";
import { ChatInput } from "./chat-input";
import { useChat } from "@/hooks/use-chat";
import { useAtlas } from "@/stores/atlas-store";
const suggestions = [
  { icon: Wallet, text: "Pisos por menos de 1.000 €" },
  { icon: GraduationCap, text: "Cerca de Ciudad Universitaria" },
  { icon: TrainFront, text: "Con buena conexión en transporte público" },
  { icon: Trees, text: "Zonas tranquilas para vivir" },
];
const areas = [
  {
    name: "Chamberí",
    note: "El encanto de la vida de barrio",
    photo: "photo-1543783207-ec64e4d95325",
    position: "center",
  },
  {
    name: "Retiro",
    note: "Un respiro en el corazón de Madrid",
    photo: "photo-1585164917700-1702b3efba11",
    position: "center",
  },
  {
    name: "Moncloa-Aravaca",
    note: "Tu siguiente capítulo, más cerca",
    photo: "photo-1539037116277-4db20889f2d4",
    position: "center",
  },
];
export function Welcome() {
  const { mutate } = useChat();
  const pending = useAtlas((s) => s.pending);
  const setMode = useAtlas((s) => s.setMode);
  return (
    <motion.div
      className="welcome"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="welcome-main">
        <div className="eyebrow">
          <span />
          MADRID, A TU MANERA
        </div>
        <h1>
          Un nuevo hogar.
          <br />
          <span>Una vida más tuya.</span>
        </h1>
        <p className="welcome-description">
          Encuentra tu próximo hogar en Madrid.
          <br />
          Cuéntanos qué buscas. Nosotros te ayudamos a encontrarlo.
        </p>
        <ChatInput welcome />
        <div className="suggestions-grid">
          {suggestions.map(({ icon: Icon, text }) => (
            <button key={text} onClick={() => mutate(text)} disabled={pending}>
              <Icon size={17} />
              <span>{text}</span>
              <ChevronRight size={13} />
            </button>
          ))}
        </div>
      </div>
      <section className="discover">
        <div className="section-heading">
          <div>
            <span className="eyebrow">CADA BARRIO, UNA FORMA DE VIVIR</span>
            <h2>Encuentra tu rincón de Madrid</h2>
          </div>
          <button className="text-link" onClick={() => setMode("map")}>
            Explorar el mapa <Map size={15} />
          </button>
        </div>
        <div className="area-grid">
          {areas.map((area, i) => (
            <button
              className={`area-card area-${i}`}
              key={area.name}
              onClick={() => mutate(`Muéstrame pisos en ${area.name}`)}
              disabled={pending}
            >
              <div
                className="area-visual"
                style={{
                  backgroundImage: `url(https://images.unsplash.com/${area.photo}?auto=format&fit=crop&w=750&q=85)`,
                  backgroundPosition: area.position,
                }}
              >
                <span className="area-location">
                  <MapPin size={12} />
                  Madrid
                </span>
                <span className="area-open">
                  <ChevronRight size={16} />
                </span>
              </div>
              <div className="area-copy">
                <h3>{area.name}</h3>
                <p>{area.note}</p>
              </div>
            </button>
          ))}
        </div>
      </section>
      <footer className="welcome-footer">
        <span>
          <MessageSquare size={14} />
          Cuéntanos qué buscas
        </span>
        <i />
        <span>
          <SlidersHorizontal size={14} />
          Afina a tu manera
        </span>
        <i />
        <span>
          <Map size={14} />
          Descubre tu lugar
        </span>
      </footer>
    </motion.div>
  );
}
