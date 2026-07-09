import type { MetadataRoute } from "next";

// PWA-Manifest — macht das Dashboard auf iPhone/iPad zum Homescreen-Icon
// mit Vollbild-Darstellung (ohne Safari-Leiste).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Hairvenly Dashboard",
    short_name: "Hairvenly",
    description: "Hairvenly Lager & Versand — Bestellungen packen, scannen, drucken.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    lang: "de",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
