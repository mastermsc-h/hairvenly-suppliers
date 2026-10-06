import { requireProfile, hasFeature } from "@/lib/auth";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import KameraClient from "./kamera-client";

export const dynamic = "force-dynamic";

// Eigenes Homescreen-Icon: "Kamera" → iPhone liegt dauerhaft als Beweisfoto-
// Kamera an der Packstation bereit (kein QR pro Bestellung mehr nötig).
export const metadata: Metadata = {
  title: "Kamera",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Kamera" },
  icons: { apple: "/scanner-icon.png", icon: "/scanner-icon-192.png" },
};

export default async function KameraPage() {
  const profile = await requireProfile();
  if (!hasFeature(profile, "shipping")) redirect("/");
  return <KameraClient />;
}
