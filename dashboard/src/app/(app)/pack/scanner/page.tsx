import { requireProfile, hasFeature } from "@/lib/auth";
import { redirect } from "next/navigation";
import { type Locale } from "@/lib/i18n";
import type { Metadata } from "next";
import ScannerClient from "./scanner-client";

export const dynamic = "force-dynamic";

// Eigenes Homescreen-Icon + Name, wenn man DIESE Seite (statt der Haupt-App)
// zum iPhone-Homescreen hinzufügt: eigenes Scanner-Icon, Titel "Scanner".
// So kann man ein separates Scanner-Icon anlegen das direkt hier startet.
export const metadata: Metadata = {
  title: "Scanner",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Scanner" },
  icons: { apple: "/scanner-icon.png", icon: "/scanner-icon-192.png" },
};

export default async function ScannerPage() {
  const profile = await requireProfile();
  if (!hasFeature(profile, "shipping")) redirect("/");
  const locale = (profile.language ?? "de") as Locale;
  return <ScannerClient locale={locale} />;
}
