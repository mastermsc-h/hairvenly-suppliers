import { requireProfile, hasFeature } from "@/lib/auth";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import KameraClient from "./kamera-client";

export const dynamic = "force-dynamic";

// Eigenes Homescreen-Icon: "Kamera" → iPhone liegt dauerhaft als Beweisfoto-
// Kamera an der Packstation bereit (kein QR pro Bestellung mehr nötig).
export const metadata: Metadata = {
  title: "Kamera",
  // Eigenes Manifest mit start_url=/pack/kamera: iOS öffnet ein Homescreen-Icon
  // IMMER an der start_url des Manifests — mit dem globalen Manifest (start_url
  // "/") landete man auf der Startseite, egal von welcher Seite man hinzufügte.
  manifest: "/manifest-kamera.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Kamera" },
  icons: { apple: "/kamera-icon.png", icon: "/kamera-icon-192.png" },
};

export default async function KameraPage() {
  const profile = await requireProfile();
  if (!hasFeature(profile, "shipping")) redirect("/");
  return <KameraClient />;
}
