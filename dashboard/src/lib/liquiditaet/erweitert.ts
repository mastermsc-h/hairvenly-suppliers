/**
 * Zusatzdaten der Liquiditätsvorschau, die nicht in `ladeRohdaten` stecken (das läuft auch in der
 * Bestellliste/Ampel und im Cockpit und soll schlank bleiben): ESt/GewSt-Hochrechnung für die erwarteten
 * Nachzahlungen und der Lagerbestand je Qualität für „nur das Nötigste“.
 * Gemeinsam genutzt von /finances/liquiditaet und Hi — beide rechnen damit dieselbe Vorschau.
 * Eigene Datei, weil cockpit/daten.ts selbst liquiditaet/daten.ts importiert (sonst Zirkelbezug).
 */
import { cache } from "react";
import { ladeSteuerKasse } from "@/lib/cockpit/daten";
import { getTotalStockKg } from "@/lib/stock-sheets";
import type { LiqRohdaten } from "./rechnung";

/** ESt/GewSt-Hochrechnung des laufenden Jahres (gleiche Rechnung wie Steuerkasse/Finanzübersicht). */
async function ladeSteuerPrognose(): Promise<LiqRohdaten["steuerPrognose"]> {
  try {
    const d = await ladeSteuerKasse();
    const pr = d.jahr.prognose;
    if (!pr) return null;
    return { jahr: d.jahr.jahr, est: pr.est, gewst: pr.gewst, vzEst: pr.vzEst, vzGewst: pr.vzGewst, nachEst: pr.nachEst, nachGewst: pr.nachGewst, gewinnJahr: pr.gewinnJahr, monate: pr.monate };
  } catch (e) {
    console.error("[liquiditaet] Steuer-Hochrechnung", e);
    return null; // Vorschau funktioniert ohne — Nachzahlung zeigt dann einen Hinweis
  }
}

/** Lagerbestand je Qualität — unvollständig gelesenes Inventar wird nicht verwendet. */
async function ladeLagerKg(): Promise<LiqRohdaten["lagerKg"]> {
  try {
    const k = await getTotalStockKg();
    return k.partial || !k.totalKg ? null : { glatt: k.russianKg, wellig: k.uzbekKg, stand: k.lastUpdated };
  } catch {
    return null;
  }
}

export const ladeRohZusatz = cache(async (): Promise<Pick<LiqRohdaten, "steuerPrognose" | "lagerKg">> => {
  const [steuerPrognose, lagerKg] = await Promise.all([ladeSteuerPrognose(), ladeLagerKg()]);
  return { steuerPrognose, lagerKg };
});
