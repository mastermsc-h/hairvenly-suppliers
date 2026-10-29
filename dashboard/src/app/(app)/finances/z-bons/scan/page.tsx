import type { Metadata } from "next";
import { requireFeature } from "@/lib/auth";
import { fetchZBonStatus } from "@/lib/actions/z-bons";
import { heuteBerlin } from "@/lib/z-bons/pruefung";
import ScanClient from "./scan-client";

export const dynamic = "force-dynamic";

// Eigenes Manifest: iOS öffnet ein Homescreen-Icon immer an der start_url des Manifests
export const metadata: Metadata = {
  title: "Z-Bons",
  manifest: "/manifest-zbon.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Z-Bons" },
  icons: { apple: "/zbon-icon.png", icon: "/zbon-icon-192.png" },
};

export default async function ZBonScanPage() {
  await requireFeature("finances");
  const heute = heuteBerlin();
  const status = await fetchZBonStatus(Number(heute.slice(0, 4)), Number(heute.slice(5, 7)));
  // Offene Tage der letzten 14 Tage als Erinnerung
  const grenze = new Date(Date.parse(`${heute}T12:00:00Z`) - 14 * 86400000).toISOString().slice(0, 10);
  let fehlend = status.fehlend;
  if (grenze.slice(0, 7) !== heute.slice(0, 7)) {
    const vor = await fetchZBonStatus(Number(grenze.slice(0, 4)), Number(grenze.slice(5, 7)));
    fehlend = [...vor.fehlend, ...fehlend];
  }
  return <ScanClient heute={heute} offen={fehlend.filter((f) => f.datum >= grenze && f.datum < heute)} />;
}
