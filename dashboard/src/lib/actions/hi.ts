"use server";

/**
 * Vorschläge von "Hi" ausführen oder verwerfen — nur durch Klick des Admins in der Vorschlagskarte.
 * Ausgeführt wird über dieselben Wege wie die Eingabemasken (setZahlTermin, saveLiquiditaetEinstellungen,
 * erstelleEintrag) bzw. für Steuer-Posten mit denselben Feldern wie im Steuer-Ledger.
 */
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { ladeEinstellungen, ladeRohdaten } from "@/lib/liquiditaet/daten";
import { prognose } from "@/lib/liquiditaet/rechnung";
import { saveLiquiditaetEinstellungen, setZahlTermin } from "./liquiditaet";
import { erstelleEintrag } from "./cockpit";

type Ergebnis = { ok: boolean; text: string };
const MAX_ALTER_MS = 24 * 3600 * 1000;
const de = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

async function ladeOffen(id: string) {
  const profile = await requireProfile();
  if (profile.role !== "admin") return { fehler: "Nur für Admins" } as const;
  const sb = createServiceClient();
  const { data } = await sb.from("hi_vorschlaege").select("id, art, daten, status, erstellt_am").eq("id", id).maybeSingle();
  if (!data) return { fehler: "Vorschlag nicht gefunden" } as const;
  // "fehler" darf erneut versucht werden — alle Wege sind wiederholbar (Steuer-Posten wird beim Ausführen neu gesucht)
  if (data.status !== "offen" && data.status !== "fehler") return { fehler: data.status === "ausgefuehrt" ? "Schon eingetragen" : "Nicht mehr offen" } as const;
  if (Date.now() - Date.parse(data.erstellt_am as string) > MAX_ALTER_MS) return { fehler: "Vorschlag ist älter als 24 Stunden — bitte Hi neu fragen" } as const;
  return { sb, v: data as { id: string; art: string; daten: Record<string, unknown> } } as const;
}

async function tiefpunkt(): Promise<string> {
  try {
    // bewusst ohne Request-Cache: wir wollen den Stand NACH dem Eintragen
    const sb = createServiceClient();
    const [roh, e] = await Promise.all([ladeRohdaten(sb), ladeEinstellungen(sb)]);
    const p = prognose(roh, e);
    return `${Math.round(p.tiefpunkt.saldo).toLocaleString("de-DE")} € am ${de(p.tiefpunkt.datum)}`;
  } catch {
    return "";
  }
}

export async function hiVorschlagAusfuehren(id: string): Promise<Ergebnis> {
  const g = await ladeOffen(id);
  if ("fehler" in g) return { ok: false, text: g.fehler ?? "Fehler" };
  const { sb, v } = g;
  const d = v.daten;
  let text = "Eingetragen.";
  try {
    if (v.art === "steuerposten") {
      const felder = {
        art: d.art as string,
        zeitraum: d.zeitraum as string,
        jahr: d.jahr as number,
        richtung: (d.richtung as string) ?? "zahlung",
        soll_betrag: d.betrag as number,
        soll_schaetzung: d.schaetzung === true,
        faellig_am: d.faellig_am as string,
        ...(d.notiz ? { notiz: d.notiz as string } : {}),
      };
      // beim Ausführen neu suchen: seit dem Vorschlag (oder einem halb gescheiterten Versuch) kann er angelegt worden sein
      const { data: da } = await sb.from("steuer_posten").select("id").eq("art", felder.art).eq("zeitraum", felder.zeitraum).limit(1);
      const vorhandenId = (da?.[0]?.id as string | undefined) ?? null;
      const { error } = vorhandenId
        ? await sb.from("steuer_posten").update(felder).eq("id", vorhandenId)
        : await sb.from("steuer_posten").insert(felder);
      if (error) throw new Error(error.message);
      // ESt-/GewSt-Nachzahlung auch in „Erwartete Nachzahlungen“ (Liquidität) spiegeln, damit beide Stellen übereinstimmen
      if ((d.art === "est_nachzahlung" || d.art === "gewst_nachzahlung") && felder.richtung === "zahlung") {
        const e = await ladeEinstellungen(sb);
        const feld = d.art === "est_nachzahlung" ? "estEur" : "gewstEur";
        const liste = e.steuerNachzahlungen ?? [];
        const da = liste.find((x) => x.jahr === felder.jahr);
        const neu = da
          ? liste.map((x) => (x === da ? { ...x, aktiv: true, datum: felder.faellig_am, [feld]: felder.soll_betrag } : x))
          : [...liste, { aktiv: true, jahr: felder.jahr, datum: felder.faellig_am, estEur: null, gewstEur: null, vzAnpassen: false, [feld]: felder.soll_betrag }];
        const r = await saveLiquiditaetEinstellungen({ ...e, steuerNachzahlungen: neu });
        if (!r.ok) throw new Error(`Steuer-Ledger gespeichert, aber „Erwartete Nachzahlungen“ nicht: ${r.error ?? "Fehler"}`);
      }
      revalidatePath("/finances/prepayments");
      revalidatePath("/finances/liquiditaet");
    } else if (v.art === "zahltermin") {
      const r = await setZahlTermin({ art: d.art as "bestellung" | "rate", schluessel: d.schluessel as string, datum: (d.datum as string | null) ?? null, notiz: (d.notiz as string | null) ?? null });
      if (!r.ok) throw new Error(r.error ?? "Termin nicht gespeichert");
    } else if (v.art === "annahme") {
      const e = await ladeEinstellungen(sb);
      const wert = d.wert as number | null;
      const neu = { ...e };
      switch (d.feld) {
        case "reserve": neu.puffer = wert ?? e.puffer; break;
        case "nachbestell_abstand_tage": neu.nachbestellAbstandTage = wert ?? e.nachbestellAbstandTage; break;
        case "amanda_kg_monat": neu.nachbestellKgMonat = wert; break;
        case "ebru_kg_monat": neu.ebruNachbestellKgMonat = wert; break;
        case "ebru_raten_abstand_tage":
          if (!e.ratenLieferanten[0]) throw new Error("Keine Ebru-Ratenregel");
          neu.ratenLieferanten = [{ ...e.ratenLieferanten[0], abstandTage: wert ?? e.ratenLieferanten[0].abstandTage }, ...e.ratenLieferanten.slice(1)];
          break;
        case "aktion_mehrumsatz_eur":
          if (!e.aktion) throw new Error("Keine Verkaufsaktion eingestellt");
          neu.aktion = { ...e.aktion, mehrumsatzBrutto: wert ?? e.aktion.mehrumsatzBrutto };
          break;
        default: throw new Error("Unbekanntes Feld");
      }
      const r = await saveLiquiditaetEinstellungen(neu);
      if (!r.ok) throw new Error(r.error ?? "Annahme nicht gespeichert");
    } else if (v.art === "eintrag") {
      const r = await erstelleEintrag({ art: d.art as "notiz" | "idee" | "aufgabe" | "meilenstein", titel: d.titel as string, text: (d.text as string) ?? "", daten: d.faellig ? { faellig: d.faellig as string } : {} });
      if (!r.ok) throw new Error(r.error ?? "Eintrag nicht gespeichert");
      revalidatePath("/start");
    } else {
      throw new Error("Unbekannte Art");
    }
    if (v.art !== "eintrag") {
      const nachher = await tiefpunkt();
      if (nachher) text = `Eingetragen. Tiefpunkt jetzt ${nachher}${d.tiefpunktVorher ? ` (vorher ${d.tiefpunktVorher})` : ""}.`;
    }
    await sb.from("hi_vorschlaege").update({ status: "ausgefuehrt", ergebnis: text, erledigt_am: new Date().toISOString() }).eq("id", id);
    return { ok: true, text };
  } catch (e) {
    const roh = e instanceof Error ? e.message : String(e);
    const msg = roh.includes("NEXT_REDIRECT") ? "Sitzung abgelaufen oder keine Berechtigung — bitte neu anmelden und nochmal klicken" : roh;
    await sb.from("hi_vorschlaege").update({ status: "fehler", ergebnis: msg, erledigt_am: new Date().toISOString() }).eq("id", id);
    return { ok: false, text: `Nicht eingetragen: ${msg}` };
  }
}

export async function hiVorschlagVerwerfen(id: string): Promise<Ergebnis> {
  const g = await ladeOffen(id);
  if ("fehler" in g) return { ok: false, text: g.fehler ?? "Fehler" };
  await g.sb.from("hi_vorschlaege").update({ status: "verworfen", erledigt_am: new Date().toISOString() }).eq("id", id);
  return { ok: true, text: "Verworfen." };
}
