import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";
export const metadata: Metadata = {
  title: "Atlas · Encuentra tu lugar en Madrid",
  description:
    "Encuentra un hogar que encaje contigo. Explora viviendas en Madrid, conversa y descubre tu próxima zona.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
