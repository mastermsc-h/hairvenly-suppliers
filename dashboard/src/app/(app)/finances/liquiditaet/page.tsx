import { redirect } from "next/navigation";
import { requireFeature } from "@/lib/auth";
import { ladeEinstellungen, ladeRohdaten } from "@/lib/liquiditaet/daten";
import { readVerkaufsanalyse } from "@/lib/stock-sheets";
import { createServiceClient } from "@/lib/supabase/server";
import Liquiditaet, { type Verbrauch } from "./liquiditaet";

export const dynamic = "force-dynamic";

async function ladeVerbrauch(): Promise<Verbrauch | null> {
  try {
    const { rows, lastUpdated } = await readVerkaufsanalyse();
    const summe = (q: string) => rows.find((r) => r.quality === q && r.isSummary) ?? null;
    const glatt = summe("Russisch Glatt");
    const wellig = summe("Usbekisch Wellig");
    if (!glatt && !wellig) return null;
    const pick = (r: typeof glatt) => (r ? { avg12mKg: r.avg12mKg, avg3mKg: r.avg3mKg, d30Kg: r.d30Kg, avg3mEur: r.avg3mEur } : null);
    return { glatt: pick(glatt), wellig: pick(wellig), stand: lastUpdated };
  } catch {
    return null; // Sheet nicht erreichbar → Seite funktioniert trotzdem
  }
}

export default async function LiquiditaetPage() {
  const profile = await requireFeature("finances");
  if (profile.role === "supplier") redirect("/");
  const sb = createServiceClient();
  const [roh, einstellungen, verbrauch] = await Promise.all([ladeRohdaten(sb), ladeEinstellungen(sb), ladeVerbrauch()]);
  return <Liquiditaet roh={roh} gespeichert={einstellungen} verbrauch={verbrauch} />;
}
