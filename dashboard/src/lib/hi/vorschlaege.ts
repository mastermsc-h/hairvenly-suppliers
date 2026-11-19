/**
 * Schreib-Vorschläge von "Hi". Hi kann nichts direkt ändern: ein Werkzeug prüft die Angaben, löst
 * Namen auf (Bestellung, Rate) und legt einen Vorschlag in hi_vorschlaege ab. Ausgeführt wird er
 * erst über die Server Action hiVorschlagAusfuehren, wenn der Admin in der Karte "Eintragen" klickt
 * — mit denselben Prüfungen wie die normalen Eingabemasken.
 */
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/server";
import { ladeEinstellungen, ladePrognose, ladeRatenDaten, ladeRohdaten } from "@/lib/liquiditaet/daten";
import { prognose, rateSchluessel } from "@/lib/liquiditaet/rechnung";

export type VorschlagArt = "steuerposten" | "zahltermin" | "annahme" | "eintrag";
export interface VorschlagKarte {
  id: string;
  titel: string;
  zeilen: string[];
}

const datum = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum als YYYY-MM-DD");
const eur = (n: number) => `${n.toLocaleString("de-DE", { maximumFractionDigits: 2 })} €`;
const de = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

const STEUERARTEN = {
  est_nachzahlung: "ESt-Nachzahlung",
  gewst_nachzahlung: "GewSt-Nachzahlung",
  ust_nachzahlung: "USt-Nachzahlung",
  est_vz: "ESt-Vorauszahlung",
  gewst_vz: "GewSt-Vorauszahlung",
  ust_va: "USt-Voranmeldung",
  lst_anmeldung: "Lohnsteuer",
  sonstige: "Sonstige Steuer",
} as const;

/** Annahmen der Liquiditätsvorschau, die Hi ändern darf (Feld → Beschreibung). */
const ANNAHMEN = {
  reserve: "Reserve / Puffer (€)",
  nachbestell_abstand_tage: "Nachbestellungen alle … Tage",
  amanda_kg_monat: "Amanda-Nachbestellung kg pro Monat (leer = Verbrauch)",
  ebru_kg_monat: "Ebru-Nachbestellung kg pro Monat (leer = Verbrauch)",
  ebru_raten_abstand_tage: "Abstand der Ebru-Raten (Tage)",
  aktion_mehrumsatz_eur: "Mehrumsatz der Verkaufsaktion brutto (€)",
} as const;

export const SCHREIB_WERKZEUGE: Anthropic.Tool[] = [
  {
    name: "vorschlag_steuerposten",
    description:
      "Schlägt einen Eintrag im Steuer-Ledger vor (z.B. Nachzahlung, Erstattung, Vorauszahlung mit Betrag und Fälligkeit). Von dort übernimmt ihn die Liquiditätsvorschau. Gibt es schon einen offenen Posten derselben Art für denselben Zeitraum, wird dieser aktualisiert statt doppelt angelegt. Der Nutzer muss den Vorschlag per Klick bestätigen — erst dann wird gespeichert.",
    input_schema: {
      type: "object",
      properties: {
        art: { type: "string", enum: Object.keys(STEUERARTEN), description: "Steuerart" },
        jahr: { type: "integer", description: "Steuerjahr, z.B. 2025" },
        zeitraum: { type: "string", description: "Zeitraum-Text wie im Ledger: bei Jahressteuern das Jahr (\"2025\"), bei USt-VA/Lohnsteuer \"YYYY-MM\", bei Vorauszahlungen \"Q1 2027\". Standard: das Jahr" },
        richtung: { type: "string", enum: ["zahlung", "erstattung"], description: "Standard: zahlung" },
        betrag: { type: "number", description: "Betrag in Euro (positiv)" },
        faellig_am: { type: "string", description: "Fälligkeit YYYY-MM-DD. Ist nur ein Monat bekannt, frage nach dem Tag oder nimm den 10." },
        schaetzung: { type: "boolean", description: "true, wenn der Betrag nur geschätzt ist (noch kein Bescheid)" },
        notiz: { type: "string" },
      },
      required: ["art", "jahr", "betrag", "faellig_am"],
    },
  },
  {
    name: "vorschlag_zahltermin",
    description:
      "Schlägt vor, einen Zahltermin in der Liquiditätsvorschau zu verschieben: eine Amanda-Bestellung (Name wie \"Amanda 18.08.2026\") oder eine Ebru-Rate (Nummer wie in der Vorschau, z.B. 2 für \"Rate 2/18\"). datum = null setzt auf den berechneten Termin zurück. Erst nach Bestätigung durch den Nutzer wirksam.",
    input_schema: {
      type: "object",
      properties: {
        art: { type: "string", enum: ["bestellung", "rate"] },
        bestellung: { type: "string", description: "Bei art=bestellung: Name der Bestellung" },
        rate_nr: { type: "integer", description: "Bei art=rate: Nummer der Ebru-Rate laut Vorschau" },
        datum: { type: ["string", "null"], description: "Neuer Termin YYYY-MM-DD oder null" },
        notiz: { type: "string" },
      },
      required: ["art", "datum"],
    },
  },
  {
    name: "vorschlag_annahme",
    description: `Schlägt vor, eine Annahme der Liquiditätsvorschau zu ändern. Felder: ${Object.entries(ANNAHMEN).map(([k, v]) => `${k} (${v})`).join("; ")}. wert = null setzt auf automatisch zurück (nur bei kg-Feldern). Erst nach Bestätigung wirksam.`,
    input_schema: {
      type: "object",
      properties: {
        feld: { type: "string", enum: Object.keys(ANNAHMEN) },
        wert: { type: ["number", "null"] },
      },
      required: ["feld", "wert"],
    },
  },
  {
    name: "vorschlag_eintrag",
    description: "Schlägt eine Notiz (privat), Idee oder Aufgabe (fürs Team) oder einen Meilenstein für den Startbildschirm vor. Erst nach Bestätigung gespeichert.",
    input_schema: {
      type: "object",
      properties: {
        art: { type: "string", enum: ["notiz", "idee", "aufgabe", "meilenstein"] },
        titel: { type: "string" },
        text: { type: "string" },
        faellig: { type: "string", description: "Optional bei Aufgaben: YYYY-MM-DD" },
      },
      required: ["art", "titel"],
    },
  },
];

export const istSchreibWerkzeug = (name: string) => SCHREIB_WERKZEUGE.some((w) => w.name === name);

async function tiefpunktText(): Promise<string> {
  try {
    const { ergebnis: p } = await ladePrognose();
    return `${eur(Math.round(p.tiefpunkt.saldo))} am ${de(p.tiefpunkt.datum)}`;
  } catch {
    return "";
  }
}

/**
 * ESt-/GewSt-Nachzahlungen schätzt die Vorschau je Jahr automatisch, bis ein Posten im Ledger steht.
 * Zeigt, welche Schätzung der neue Posten ersetzt und welche danach noch zusätzlich zählt — damit ein
 * Gesamtbetrag (ESt + GewSt) nicht doppelt in der Vorschau landet.
 */
async function schaetzungsHinweis(art: string, jahr: number): Promise<string[]> {
  if (art !== "est_nachzahlung" && art !== "gewst_nachzahlung") return [];
  try {
    // eigene Rechnung mit langem Horizont: die Schätzung liegt oft hinter dem eingestellten Vorschau-Zeitraum
    const sb = createServiceClient();
    const [roh, e0] = await Promise.all([ladeRohdaten(sb), ladeEinstellungen(sb)]);
    const p = prognose(roh, { ...e0, horizontTage: Math.max(e0.horizontTage, 1100) });
    const geschaetzt = (name: string) =>
      p.ereignisse.filter((x) => x.label.startsWith(`${name} ${jahr}`) && x.label.includes("(erwartet)")).reduce((s, x) => s - x.betrag, 0);
    const eigen = art === "est_nachzahlung" ? "ESt-Nachzahlung" : "GewSt-Nachzahlung";
    const andere = art === "est_nachzahlung" ? "GewSt-Nachzahlung" : "ESt-Nachzahlung";
    const out: string[] = [];
    const e = geschaetzt(eigen);
    if (e > 0) out.push(`Ersetzt die bisherige Schätzung ${eigen} ${jahr}: ${eur(Math.round(e))}`);
    const a = geschaetzt(andere);
    if (a > 0) out.push(`Bleibt zusätzlich in der Vorschau: ${andere} ${jahr} (Schätzung) ${eur(Math.round(a))} — falls der Betrag beides enthält, bitte Hi sagen`);
    return out;
  } catch {
    return [];
  }
}

/** Prüft die Angaben, löst Namen auf und legt den Vorschlag ab. */
export async function erstelleVorschlag(name: string, input: unknown, profilId: string | null): Promise<VorschlagKarte> {
  const sb = createServiceClient();
  let art: VorschlagArt;
  let titel: string;
  let zeilen: string[];
  let daten: Record<string, unknown>;

  switch (name) {
    case "vorschlag_steuerposten": {
      const i = z
        .object({
          art: z.enum(Object.keys(STEUERARTEN) as [keyof typeof STEUERARTEN, ...Array<keyof typeof STEUERARTEN>]),
          jahr: z.number().int().min(2020).max(2035),
          zeitraum: z.string().max(40).optional(),
          richtung: z.enum(["zahlung", "erstattung"]).optional(),
          betrag: z.number().positive().max(10_000_000),
          faellig_am: datum,
          schaetzung: z.boolean().optional(),
          notiz: z.string().max(500).optional(),
        })
        .parse(input);
      const zeitraum = (i.zeitraum ?? String(i.jahr)).trim();
      const { data: vorhanden } = await sb
        .from("steuer_posten")
        .select("id, soll_betrag, faellig_am, ist_betrag")
        .eq("art", i.art)
        .eq("zeitraum", zeitraum)
        .maybeSingle();
      art = "steuerposten";
      titel = `${vorhanden ? "Steuer-Posten ändern" : "Ins Steuer-Ledger eintragen"}: ${STEUERARTEN[i.art]} ${zeitraum}`;
      zeilen = [
        `${i.richtung === "erstattung" ? "Erstattung" : "Zahlung"}: ${eur(i.betrag)}${i.schaetzung ? " (Schätzung)" : ""}`,
        `Fällig: ${de(i.faellig_am)}`,
        ...(vorhanden ? [`Bisher: ${eur(Number(vorhanden.soll_betrag))}${vorhanden.faellig_am ? `, fällig ${de(String(vorhanden.faellig_am))}` : ""}`] : []),
        ...(i.notiz ? [`Notiz: ${i.notiz}`] : []),
        "Erscheint danach in der Liquiditätsvorschau.",
        ...((i.art === "est_nachzahlung" || i.art === "gewst_nachzahlung") && i.richtung !== "erstattung"
          ? [`Wird auch unter „Erwartete Nachzahlungen ${i.jahr}“ (Liquidität) übernommen: ${i.art === "est_nachzahlung" ? "ESt" : "GewSt"} ${eur(i.betrag)}, fällig ${de(i.faellig_am)}.`]
          : []),
        ...(await schaetzungsHinweis(i.art, i.jahr)),
      ];
      daten = { ...i, zeitraum, vorhandenId: vorhanden?.id ?? null, tiefpunktVorher: await tiefpunktText() };
      break;
    }
    case "vorschlag_zahltermin": {
      const i = z
        .object({ art: z.enum(["bestellung", "rate"]), bestellung: z.string().max(120).optional(), rate_nr: z.number().int().min(1).max(200).optional(), datum: datum.nullable(), notiz: z.string().max(200).optional() })
        .parse(input);
      let schluessel: string;
      let was: string;
      if (i.art === "bestellung") {
        if (!i.bestellung) throw new Error("Name der Bestellung fehlt");
        const { data } = await sb.from("orders").select("id, label").ilike("label", `%${i.bestellung.replace(/[%_]/g, "")}%`).not("status", "in", "(cancelled,hidden)").limit(5);
        const treffer = (data ?? []) as Array<{ id: string; label: string }>;
        const genau = treffer.filter((t) => t.label.toLowerCase() === i.bestellung!.toLowerCase());
        const wahl = genau.length === 1 ? genau[0] : treffer.length === 1 ? treffer[0] : null;
        if (!wahl) throw new Error(treffer.length ? `Mehrdeutig: ${treffer.map((t) => t.label).join(", ")}` : `Keine Bestellung "${i.bestellung}" gefunden`);
        schluessel = wahl.id;
        was = wahl.label;
      } else {
        if (!i.rate_nr) throw new Error("Nummer der Rate fehlt");
        const { ratenPositionen } = await ladeRatenDaten(sb, await ladeEinstellungen(sb));
        const lieferant = ratenPositionen.find((p) => /ebru/i.test(p.lieferant))?.lieferant;
        if (!lieferant) throw new Error("Kein offener Ebru-Ratenplan");
        schluessel = rateSchluessel(lieferant, i.rate_nr);
        was = `${lieferant} Rate ${i.rate_nr}`;
      }
      art = "zahltermin";
      titel = `Zahltermin ${i.datum ? "verschieben" : "zurücksetzen"}: ${was}`;
      zeilen = [i.datum ? `Neuer Termin: ${de(i.datum)}` : "Zurück auf den berechneten Termin", ...(i.notiz ? [`Notiz: ${i.notiz}`] : [])];
      daten = { art: i.art, schluessel, datum: i.datum, notiz: i.notiz ?? null, was, tiefpunktVorher: await tiefpunktText() };
      break;
    }
    case "vorschlag_annahme": {
      const i = z.object({ feld: z.enum(Object.keys(ANNAHMEN) as [keyof typeof ANNAHMEN, ...Array<keyof typeof ANNAHMEN>]), wert: z.number().min(0).max(10_000_000).nullable() }).parse(input);
      if (i.wert === null && !i.feld.endsWith("kg_monat")) throw new Error("Für dieses Feld ist ein Wert nötig");
      art = "annahme";
      titel = `Annahme ändern: ${ANNAHMEN[i.feld]}`;
      const e = await ladeEinstellungen(sb);
      const bisher: Record<keyof typeof ANNAHMEN, number | null | undefined> = {
        reserve: e.puffer,
        nachbestell_abstand_tage: e.nachbestellAbstandTage,
        amanda_kg_monat: e.nachbestellKgMonat,
        ebru_kg_monat: e.ebruNachbestellKgMonat,
        ebru_raten_abstand_tage: e.ratenLieferanten[0]?.abstandTage,
        aktion_mehrumsatz_eur: e.aktion?.mehrumsatzBrutto,
      };
      if (i.feld === "ebru_raten_abstand_tage" && !e.ratenLieferanten[0]) throw new Error("Es gibt keine Ebru-Ratenregel");
      if (i.feld === "aktion_mehrumsatz_eur" && !e.aktion) throw new Error("Es ist keine Verkaufsaktion eingestellt");
      const alt = bisher[i.feld];
      zeilen = [`Bisher: ${alt == null ? "automatisch" : alt.toLocaleString("de-DE")}`, i.wert === null ? "Neu: automatisch" : `Neu: ${i.wert.toLocaleString("de-DE")}`];
      daten = { ...i, tiefpunktVorher: await tiefpunktText() };
      break;
    }
    case "vorschlag_eintrag": {
      const i = z.object({ art: z.enum(["notiz", "idee", "aufgabe", "meilenstein"]), titel: z.string().min(1).max(200), text: z.string().max(3000).optional(), faellig: datum.optional() }).parse(input);
      const name = { notiz: "Notiz", idee: "Idee", aufgabe: "Aufgabe", meilenstein: "Meilenstein" }[i.art];
      art = "eintrag";
      titel = `${name} im Startbildschirm anlegen`;
      zeilen = [i.titel, ...(i.text ? [i.text.slice(0, 160)] : []), ...(i.faellig ? [`Fällig: ${de(i.faellig)}`] : [])];
      daten = i;
      break;
    }
    default:
      throw new Error(`Unbekanntes Werkzeug: ${name}`);
  }

  const { data, error } = await sb.from("hi_vorschlaege").insert({ profil_id: profilId, art, titel, zeilen, daten }).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "Vorschlag nicht gespeichert");
  return { id: data.id as string, titel, zeilen };
}
