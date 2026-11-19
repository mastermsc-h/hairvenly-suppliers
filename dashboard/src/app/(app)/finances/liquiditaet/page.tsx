import { redirect } from "next/navigation";
import { requireFeature } from "@/lib/auth";
import { ladeEinstellungen, ladeKontoVerlauf, ladeRohdaten } from "@/lib/liquiditaet/daten";
import { getTotalStockKg, readVerkaufsanalyse } from "@/lib/stock-sheets";
import { createServiceClient } from "@/lib/supabase/server";
import Liquiditaet, { type Verbrauch } from "./liquiditaet";
import UstMonate from "../ust-monate";
import { ladeUstMonate } from "@/lib/steuer/ust-monate";
import { ladeSteuerKasse } from "@/lib/cockpit/daten";
import type { LiqRohdaten } from "@/lib/liquiditaet/rechnung";

/** ESt/GewSt-Hochrechnung des laufenden Jahres (gleiche Rechnung wie Steuerkasse/Finanzübersicht). */
async function ladeSteuerPrognose(): Promise<LiqRohdaten["steuerPrognose"]> {
  try {
    const d = await ladeSteuerKasse();
    const pr = d.jahr.prognose;
    if (!pr) return null;
    return { jahr: d.jahr.jahr, est: pr.est, gewst: pr.gewst, vzEst: pr.vzEst, vzGewst: pr.vzGewst, nachEst: pr.nachEst, nachGewst: pr.nachGewst, gewinnJahr: pr.gewinnJahr, monate: pr.monate };
  } catch (e) {
    console.error("[liquiditaet] Steuer-Hochrechnung", e);
    return null; // Seite funktioniert ohne — Nachzahlung zeigt dann einen Hinweis
  }
}

export const dynamic = "force-dynamic";

const heuteBerlinDatum = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });

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
  const jahr = Number(heuteBerlinDatum().slice(0, 4));
  const [rohBasis, einstellungen, verbrauch, ustMonate, steuerPrognose, lager] = await Promise.all([
    ladeRohdaten(sb),
    ladeEinstellungen(sb),
    ladeVerbrauch(),
    ladeUstMonate(jahr, sb).catch((e) => {
      console.error("[liquiditaet] USt je Monat", e);
      return [];
    }),
    ladeSteuerPrognose(),
    // Lagerbestand je Qualität für „nur das Nötigste“ — unvollständig gelesen = nicht verwenden
    getTotalStockKg().then((k) => (k.partial || !k.totalKg ? null : { glatt: k.russianKg, wellig: k.uzbekKg, stand: k.lastUpdated })).catch(() => null),
  ]);
  const roh: LiqRohdaten = { ...rohBasis, steuerPrognose, lagerKg: lager };
  const verlauf = await ladeKontoVerlauf(sb, roh, einstellungen);
  return (
    <>
      <Liquiditaet roh={roh} gespeichert={einstellungen} verbrauch={verbrauch} verlauf={verlauf} />
      <div className="px-4 md:px-8 pb-8 max-w-6xl mx-auto">
        <UstMonate jahr={jahr} monate={ustMonate} />
      </div>
    </>
  );
}
