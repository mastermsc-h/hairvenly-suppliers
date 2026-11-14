/**
 * Liquiditätsvorschau — REINE FUNKTIONEN ohne Abhängigkeiten (Server + Client).
 * Getestet in scripts/smoke/liquiditaet.spec.mjs.
 *
 * Idee: Kontostand heute + Ø Einnahmen/Tag − Ø laufende Abgänge/Tag, dazu die
 * datierten Einzelzahlungen (Lieferanten bei "versandbereit", Einfuhrabgaben bei
 * Ankunft, Steuertermine). Für jede Amanda-Bestellung: reicht das Geld am Zahltag?
 */
import { faelligkeit } from "@/lib/bank/kategorien";

// ── Kontoauszug-Texte ───────────────────────────────────────────────────────

/**
 * Kontostand aus dem Sparkassen-Monatsabschluss ("Information zur Abrechnung
 * Kontostand am 30.09.2026 98.449,21 +"). Bewusst NICHT der "Rechnungsabschluss"-
 * Wert: der enthält schon die Entgelte, die erst am Folgetag gebucht werden.
 * Nachgeprüft 18.10.2026: Abschluss + Buchungen bis zum nächsten Abschluss = cent-genau.
 */
export function parseKontostand(purpose: string | null): { am: string; betrag: number } | null {
  if (!purpose) return null;
  const m = purpose
    .replace(/\s+/g, " ")
    .match(/Information zur Abrechnung\s*Kontostand am (\d{2})\.(\d{2})\.(\d{4})\s*([\d.]+,\d{2})\s*([+-])/);
  if (!m) return null;
  const betrag = Number(m[4].replace(/\./g, "").replace(",", "."));
  return { am: `${m[3]}-${m[2]}-${m[1]}`, betrag: m[5] === "-" ? -betrag : betrag };
}

/** Wechselkurs aus einer Sparkassen-Auslandsüberweisung: "USD30000,00 1,15950" → 1.1595 USD pro EUR. */
export function parseFxKurs(purpose: string | null): number | null {
  if (!purpose) return null;
  const m = purpose.match(/USD\s?[\d.]+,\d{2}\s+(\d,\d{3,5})/);
  if (!m) return null;
  const kurs = Number(m[1].replace(",", "."));
  return kurs > 0.5 && kurs < 2 ? kurs : null;
}

// ── Datum ───────────────────────────────────────────────────────────────────

export function plusTage(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function tageZwischen(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}
const monatVon = (iso: string) => iso.slice(0, 7);
function naechsterMonat(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
}

// ── Einstellungen ───────────────────────────────────────────────────────────

export interface LiqEinstellungen {
  /** Zahlung an Amanda so viele Tage vor dem Ankunftsdatum (= wenn versandbereit). */
  zahlungVorAnkunftTage: number;
  eustSatz: number; // %
  zollSatz: number; // % (Haar-Extensions HS 6704: 2,2 %)
  frachtProzent: number; // % Aufschlag auf den Warenwert für den Zollwert
  /** USD pro EUR; null = letzter Kurs aus den Kontoumsätzen. */
  fxUsdProEur: number | null;
  /** Sicherheitsreserve: darunter gilt eine Zahlung als "knapp". */
  puffer: number;
  horizontTage: number;
  /** USt-Zahllast pro Monat VOR Verrechnung der EUSt; null = aus den letzten Monaten. */
  ustBasisMonat: number | null;
  /** Ebru/andere Lieferanten als Ø der Kontoumsätze einrechnen (Ebru-Liste noch nicht gepflegt). */
  andereLieferantenEinrechnen: boolean;
  /** Künftige Amanda-Nachbestellungen (wöchentlich) als Schätzung einrechnen. */
  nachbestellungenEinrechnen: boolean;
  nachbestellKgMonat: number | null; // null = Verbrauch laut Verkaufsanalyse (sonst Ø Bestellungen)
  usdProKg: number | null; // null = Ø der letzten Bestellungen
  /** Laufende Abgänge, die ab jetzt wegfallen (z.B. "aus_kredit" — Shopify Capital abbezahlt 19.10.2026). */
  ausgeblendeteKategorien: string[];
  /** Verkaufsaktion mit Mehrumsatz (Black Friday) — null = keine. */
  aktion: LiqAktion | null;
  /** Manuelle Positionen (Sammelrechnungen): sofort fällig, bezahlt in festen Raten. */
  manuellRateUsd: number;
  /** Zahlungsfrist ab Datum der Position (Tage) — erste Rate frühestens dann. */
  manuellFristTage: number;
  /** Abstand zwischen zwei Raten an denselben Lieferanten (Tage). */
  manuellAbstandTage: number;
  /** Lieferanten, deren GESAMTE offene Rechnungen in Raten bezahlt werden (Ebru). */
  ratenLieferanten: LiqRatenRegel[];
  /** PayPal-Guthaben (noch nicht aufs Konto überwiesen) als verfügbares Geld mitzählen. */
  paypalEinrechnen: boolean;
  /** Amanda-Anzahlung: Rest so viele Tage nach der Anzahlung (Vorschlag im Terminfeld). */
  restNachAnzahlungTage: number;
  /** Künftige Ebru-Nachbestellungen (wöchentlich) als Schätzung: Rechnung bei Versand → hinten in die Raten, Einfuhrabgaben bei Ankunft. */
  ebruNachbestellungenEinrechnen: boolean;
  /** Abbuchungen von DHL (ZIT) / Ungewitter ohne zugeordnete Bestellung gegen die Einfuhr-Schätzung verschickter Ware verrechnen. */
  zollAbbuchungenVerrechnen: boolean;
  /** Bestellrhythmus der Nachbestellungen (Amanda + Ebru), gerechnet ab der letzten echten Bestellung. */
  nachbestellAbstandTage: number;
  ebruNachbestellKgMonat: number | null; // null = Ø Bestellungen der letzten 6 Monate
  ebruUsdProKg: number | null; // null = Ø der letzten Bestellungen
}

export interface LiqRatenRegel {
  /** Teil des Lieferantennamens, z.B. "Ebru". */
  name: string;
  rateUsd: number;
  /** Erste Rate frühestens so viele Tage nach Rechnungseingang (= Datum der Position). */
  fristTage: number;
  /** Abstand zwischen zwei Raten (Tage), gerechnet ab der letzten tatsächlichen Zahlung. */
  abstandTage: number;
  /** Empfängername in den Kontoumsätzen (für "letzte Zahlung"). */
  bankMuster: string;
  /** Rhythmuswechsel: ab diesem Tag gilt `abstandTageAb` (erste Rate im neuen Rhythmus spätestens an diesem Tag). */
  wechselAb?: string | null;
  abstandTageAb?: number | null;
}

/** Regel für einen Lieferanten: eigene Ratenregel oder die allgemeine für manuelle Positionen. */
export function ratenRegelFuer(lieferant: string, e: LiqEinstellungen): LiqRatenRegel {
  const l = lieferant.toLowerCase();
  return (
    e.ratenLieferanten.find((r) => r.name && l.includes(r.name.toLowerCase())) ?? {
      name: lieferant,
      rateUsd: e.manuellRateUsd,
      fristTage: e.manuellFristTage,
      abstandTage: e.manuellAbstandTage,
      bankMuster: "",
    }
  );
}

export interface LiqAktion {
  aktiv: boolean;
  label: string;
  von: string; // YYYY-MM-DD
  bis: string;
  /** Mehrumsatz brutto inkl. USt über den ganzen Zeitraum (über dem normalen Niveau). */
  mehrumsatzBrutto: number;
  /** Verteilung auf die Tage (Anteile, Summe beliebig) — z.B. Tagesprofil des Vorjahres. */
  profil: number[];
  /** Tage bis das Geld auf dem Konto ist (Stripe/PayPal-Auszahlung). */
  verzugTage: number;
  /** Anteil, der nach Zahlungsgebühren ankommt (%). */
  auszahlungProzent: number;
  quelle: string;
  /** Flaute nach der Aktion (vorgezogene Käufe): Zeiträume mit Anteil der normalen Einnahmen. */
  nachlauf?: LiqNachlauf | null;
}

export interface LiqNachlauf {
  aktiv: boolean;
  /** faktor = Anteil der normalen Tageseinnahmen (0,57 = 57 %). */
  abschnitte: Array<{ von: string; bis: string; faktor: number }>;
  quelle: string;
}

export const LIQ_DEFAULTS: LiqEinstellungen = {
  zahlungVorAnkunftTage: 7,
  eustSatz: 19,
  zollSatz: 2.2,
  frachtProzent: 0,
  fxUsdProEur: null,
  puffer: 20_000,
  horizontTage: 90,
  ustBasisMonat: null,
  andereLieferantenEinrechnen: false,
  nachbestellungenEinrechnen: false,
  nachbestellKgMonat: null,
  usdProKg: null,
  ausgeblendeteKategorien: [],
  aktion: null,
  manuellRateUsd: 40_000,
  manuellFristTage: 14,
  manuellAbstandTage: 14,
  // User 20.10.2026: Ebru — 2 Wochen nach Rechnungseingang erste Rate à 40k $, dann alle 2 Wochen
  ratenLieferanten: [{ name: "Ebru", rateUsd: 40_000, fristTage: 14, abstandTage: 14, bankMuster: "JUANCHENG" }],
  paypalEinrechnen: true,
  // User 03.11.2026: nach einer Anzahlung bleiben 4 Wochen für den Rest
  restNachAnzahlungTage: 28,
  ebruNachbestellungenEinrechnen: false,
  // User 06.11.2026: schon abgebuchte, aber nicht zugeordnete ZIT-Rechnungen nicht doppelt rechnen
  zollAbbuchungenVerrechnen: true,
  // User 14.11.2026: "wir bestellen alle zwei Wochen, was benötigt wird"
  nachbestellAbstandTage: 14,
  ebruNachbestellKgMonat: null,
  ebruUsdProKg: null,
};

export function mitDefaults(e: Partial<LiqEinstellungen> | null | undefined): LiqEinstellungen {
  return { ...LIQ_DEFAULTS, ...(e ?? {}) };
}

// ── Rohdaten (vom Server gesammelt) ─────────────────────────────────────────

export interface LiqBestellung {
  id: string;
  label: string;
  status: string;
  eta: string | null;
  invoiceUsd: number | null;
  restUsd: number;
  importVatEur: number | null;
  kg: number | null;
  /** Eingetragene DHL-/Zoll-Rechnungsnummer(n) — Rohtext wie im Feld. */
  einfuhrRechnung?: string | null;
  /** Abgleich der Rechnungsnummern mit den Kontoumsätzen (nur wenn welche eingetragen sind). */
  einfuhrZahlung?: EinfuhrZahlung | null;
  /** Tag, an dem der Status auf "versendet"/"beim Zoll" gesetzt wurde (Statusverlauf). */
  versandAm?: string | null;
}

/** Lieferung eines Ratenlieferanten (Ebru): Einfuhrabgaben bei Ankunft, bezahlt wird über die Raten. */
export interface LiqEinfuhrPosten {
  id: string;
  label: string;
  lieferant: string;
  status: string;
  eta: string | null;
  /** Rechnungs- bzw. geschätzter Warenwert (USD). */
  warenUsd: number;
  importVatEur: number | null;
  /** Noch keine Rechnung (in Produktion) — Warenwert geschätzt. */
  geschaetzt: boolean;
  einfuhrRechnung?: string | null;
  einfuhrZahlung?: EinfuhrZahlung | null;
  versandAm?: string | null;
}

// ── Einfuhrabgaben ↔ Kontoumsatz ────────────────────────────────────────────

/** Abbuchungen, in deren Verwendungszweck die Rechnungsnummer(n) einer Bestellung stehen. */
export interface EinfuhrZahlung {
  /** Eingetragene Nummern (normalisiert). */
  rechnungen: string[];
  /** Davon auf dem Konto gefunden. */
  gefunden: string[];
  /** Summe der gefundenen Abbuchungen (positiv). */
  betragEur: number;
  /** Letzte gefundene Abbuchung. */
  datum: string | null;
  /** Eine Abbuchung enthält auch fremde Rechnungen (DHL-Sammelzahlung) → Betrag nicht nur diese Bestellung. */
  sammel: boolean;
}

const nurZeichen = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * "ZIT8150777, zit 8150778" → ["ZIT8150777", "ZIT8150778"]. Getrennt wird an Komma, Semikolon,
 * Schrägstrich und Zeilenumbruch — Leerzeichen bleiben Teil der Nummer ("26 33474" = Ungewitter-Rechnung).
 */
export function rechnungsNummern(text: string | null | undefined): string[] {
  if (!text) return [];
  const out = text.split(/[,;\/\n]+/).map(nurZeichen).filter((x) => x.length >= 5);
  return [...new Set(out)];
}

/**
 * Sucht jede eingetragene Rechnungsnummer im Verwendungszweck der Abbuchungen (Satzzeichen und
 * Leerzeichen egal). Gutschriften zählen nicht. Bestellungen ohne Nummer fehlen in der Map.
 */
export function einfuhrZahlungen(
  bestellungen: Array<{ id: string; rechnung: string | null | undefined }>,
  buchungen: Array<{ datum: string; betrag: number; zweck: string | null }>,
): Map<string, EinfuhrZahlung> {
  const abb = buchungen.filter((t) => t.betrag < 0 && t.zweck).map((t) => ({ ...t, n: nurZeichen(t.zweck as string) }));
  const nummern = bestellungen.map((b) => ({ id: b.id, nr: rechnungsNummern(b.rechnung) })).filter((b) => b.nr.length);
  const out = new Map<string, EinfuhrZahlung>();
  for (const b of nummern) {
    const treffer = new Set<(typeof abb)[number]>();
    const gefunden: string[] = [];
    for (const nr of b.nr) {
      const hits = abb.filter((t) => t.n.includes(nr));
      if (hits.length) gefunden.push(nr);
      hits.forEach((t) => treffer.add(t));
    }
    const fremd = (t: (typeof abb)[number]) =>
      nummern.some((o) => o.id !== b.id && o.nr.some((nr) => t.n.includes(nr))) ||
      (t.n.match(/ZIT\d{5,}/g) ?? []).some((z) => !b.nr.some((nr) => nr === z || nr.includes(z) || z.includes(nr)));
    const liste = [...treffer];
    out.set(b.id, {
      rechnungen: b.nr,
      gefunden,
      betragEur: r2(liste.reduce((s, t) => s - t.betrag, 0)),
      datum: liste.length ? liste.map((t) => t.datum).sort().at(-1)! : null,
      sammel: liste.some(fremd),
    });
  }
  return out;
}

/** Abbuchung eines Verzollers (DHL Express: ZIT-Rechnung, Carl Ungewitter: RG.-Nr.), noch keiner Bestellung zugeordnet. */
export interface ZollBuchung {
  datum: string;
  betragEur: number;
  /** Rechnungsnummern wie im Verwendungszweck ("ZIT8150777", "26 33474"). */
  nummern: string[];
  art: "dhl" | "ungewitter";
}

/** Vermutlich schon bezahlte Einfuhrabgaben: nicht zugeordnete Abbuchungen nach dem Versand. */
export interface EinfuhrVermutung {
  nummern: string[];
  /** Letzte der verrechneten Abbuchungen. */
  datum: string;
  /** Summe der verrechneten Abbuchungen (ganz). */
  betragEur: number;
  /** Davon gegen diese Bestellung verrechnet. */
  anteilEur: number;
  /** Deckt die ganze Schätzung. */
  vollstaendig: boolean;
}

/**
 * Verzoller-Abbuchungen, deren Rechnungsnummer an keiner Bestellung eingetragen ist. Eine Abbuchung,
 * in der irgendeine eingetragene Nummer vorkommt, fällt ganz raus (Anteil bei Sammelzahlungen unbekannt).
 */
export function offeneZollBuchungen(
  buchungen: Array<{ datum: string; betrag: number; zweck: string | null; gegenpartei: string | null; kategorie: string | null }>,
  eingetragen: Array<string | null | undefined>,
): ZollBuchung[] {
  const nummern = eingetragen.flatMap((t) => rechnungsNummern(t));
  const out: ZollBuchung[] = [];
  for (const t of buchungen) {
    if (t.betrag >= 0 || t.kategorie !== "st_eust" || !t.zweck) continue;
    const n = nurZeichen(t.zweck);
    if (nummern.some((nr) => n.includes(nr))) continue;
    const zit = [...new Set(n.match(/ZIT\d{5,}/g) ?? [])];
    if (zit.length) {
      out.push({ datum: t.datum, betragEur: r2(-t.betrag), nummern: zit, art: "dhl" });
      continue;
    }
    if (/ungewitter/i.test(t.gegenpartei ?? "")) {
      const rg = t.zweck.match(/RG\.?-?\s*NR\.*\s*([\d][\d ]{3,}\d)/i)?.[1]?.trim();
      out.push({ datum: t.datum, betragEur: r2(-t.betrag), nummern: rg ? [rg] : [], art: "ungewitter" });
    }
  }
  return out.sort((a, b) => a.datum.localeCompare(b.datum));
}

/**
 * Ordnet nicht zugeordnete Verzoller-Abbuchungen verschickter Ware zu: älteste Sendung zuerst, nur
 * Abbuchungen nach dem Versandtag (bis `fensterTage` danach) und vom passenden Verzoller. Eine
 * Abbuchung kann mehrere Sendungen decken (DHL fasst zusammen), jeder Euro wird nur einmal verrechnet.
 */
export function zollVermutungen(
  kandidaten: Array<{ id: string; art: ZollBuchung["art"]; versandAm: string; eur: number }>,
  buchungen: ZollBuchung[],
  fensterTage = 30,
): Map<string, EinfuhrVermutung> {
  const rest = buchungen.map((b) => b.betragEur);
  const out = new Map<string, EinfuhrVermutung>();
  const sortiert = [...kandidaten].sort((a, b) => a.versandAm.localeCompare(b.versandAm) || a.id.localeCompare(b.id));
  for (const k of sortiert) {
    let offen = k.eur;
    const genutzt: number[] = [];
    let anteil = 0;
    buchungen.forEach((b, i) => {
      if (offen <= 0.005 || rest[i] <= 0.005 || b.art !== k.art) return;
      // Erst nach dem Versandtag — am selben Tag kann noch keine Zoll-Rechnung abgebucht sein
      if (b.datum <= k.versandAm || b.datum > plusTage(k.versandAm, fensterTage)) return;
      const nimm = Math.min(rest[i], offen);
      rest[i] = r2(rest[i] - nimm);
      offen = r2(offen - nimm);
      anteil = r2(anteil + nimm);
      genutzt.push(i);
    });
    if (!genutzt.length) continue;
    out.set(k.id, {
      nummern: [...new Set(genutzt.flatMap((i) => buchungen[i].nummern))],
      datum: genutzt.map((i) => buchungen[i].datum).sort().at(-1)!,
      betragEur: r2(genutzt.reduce((s, i) => s + buchungen[i].betragEur, 0)),
      anteilEur: anteil,
      vollstaendig: offen <= 0.005,
    });
  }
  return out;
}

/** Lieferanten-Zahlung, an der Bestellung eingetragen, deren Abbuchung (noch) fehlt. */
export interface ZahlungUnterwegs {
  id: string;
  orderId: string;
  label: string;
  lieferant: string;
  /** Zahldatum laut Eintrag. */
  datum: string;
  usd: number;
  art: "amanda" | "raten";
}

/** USD-Beträge aus dem Verwendungszweck einer Auslandsüberweisung ("USD29646,07", "USD  -6.142,00"). */
export function usdImZweck(zweck: string | null): number[] {
  return [...(zweck ?? "").matchAll(/USD\s*-?\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/gi)].map((m) => Number(m[1].replace(/\./g, "").replace(",", ".")));
}

/**
 * Eingetragene Zahlungen der letzten `tage` Tage ohne passende Abbuchung: Wareneinkauf-Abbuchung mit
 * demselben USD-Betrag ab 5 Tage vor dem Zahldatum. Jede Abbuchung deckt nur eine Zahlung. Die Bank
 * zeigt Auslandsüberweisungen erst nach 1–3 Tagen — bis dahin zählt die Zahlung als "unterwegs".
 */
export function zahlungenOhneAbbuchung<T extends { datum: string; usd: number }>(
  zahlungen: T[],
  buchungen: Array<{ datum: string; betrag: number; zweck: string | null; kategorie: string | null }>,
  heute: string,
  tage = 10,
): T[] {
  const abb = buchungen.filter((t) => t.betrag < 0 && t.kategorie === "aus_wareneinkauf").map((t) => ({ datum: t.datum, usd: usdImZweck(t.zweck) }));
  const benutzt = new Set<number>();
  return [...zahlungen]
    .filter((z) => z.datum >= plusTage(heute, -tage) && z.usd > 0)
    .sort((a, b) => a.datum.localeCompare(b.datum))
    .filter((z) => {
      const i = abb.findIndex((t, j) => !benutzt.has(j) && t.datum >= plusTage(z.datum, -5) && t.usd.some((u) => Math.abs(u - z.usd) < 0.01));
      if (i < 0) return true;
      benutzt.add(i);
      return false;
    });
}

/** Manuelle Position (Status "manual"): Rechnung ohne Warenbewegung, z.B. Sammelrechnung. */
export interface LiqManuellePosition {
  id: string;
  label: string;
  lieferant: string;
  /** Datum der Position (Bestell-/Rechnungsdatum) — Frist läuft ab hier. */
  datum: string;
  restUsd: number;
  /** Noch keine Rechnung (Ware in Produktion / Nachbestellung): Betrag und Datum geschätzt. */
  geschaetzt?: boolean;
}

/** Von Hand verschobener Zahltermin — nur Planung, Rechnung und Saldo bleiben unberührt. */
export interface LiqVerschiebung {
  datum: string;
  notiz: string | null;
  /** Nur Raten: letzte Bankzahlung beim Verschieben. Eine neuere = Rate bezahlt → erledigt. */
  basisZahlung?: string | null;
  /** Nur Bestellungen: geplante Anzahlung (USD) am `datum`, der Rest am `restDatum`. */
  anzahlungUsd?: number | null;
  restDatum?: string | null;
  /** Offener Betrag beim Planen. Ist der Rest heute kleiner, gilt die Anzahlung als bezahlt. */
  restBasisUsd?: number | null;
}

export interface LiqVerschiebungen {
  /** order id → Termin */
  bestellungen: Record<string, LiqVerschiebung>;
  /** Raten-Schlüssel (rateSchluessel: "Lieferant" = Rate 1, "Lieferant#3" = Rate 3 beim Planen) → Termin; Folgeraten rutschen mit */
  raten: Record<string, LiqVerschiebung>;
}

/** Wie ein Zahltermin zustande kam. */
export interface TerminStand {
  /** Termin laut Regel, ohne Verschiebung. */
  regelDatum: string;
  verschoben: boolean;
  notiz: string | null;
  /** Verschobener Termin ist verstrichen, ohne dass bezahlt wurde. */
  abgelaufenAm: string | null;
}

export interface LiqRohdaten {
  heute: string;
  /** Saldo der Geschäftskonten (ohne Targobank-Gehaltskonto) zum Stand `saldoStand`. */
  startSaldo: number;
  saldoStand: string;
  konten: Array<{ iban: string; saldo: number; anker: string }>;
  /** Kontostände direkt von der Bank (FinTS) — Sparkasse als Gegenprobe, Targobank separat. Nicht Teil der Rechnung. */
  bankSalden: Array<{ iban: string; saldo: number; stand: string; abgerufenAm: string }>;
  basis: {
    monate: string[];
    tage: number;
    einnahmen: number; // Summe im Basiszeitraum (positiv)
    laufend: Array<{ kategorie: string; summe: number }>; // Summen (negativ)
    andereLieferanten: number; // Summe Wareneinkauf ohne Amanda (negativ)
    monatsWerte: Array<{ monat: string; einnahmen: number; tage: number }>;
  };
  fxAuto: { kurs: number; datum: string } | null;
  bestellungen: LiqBestellung[];
  /** @deprecated → ratenPositionen */
  manuellePositionen?: LiqManuellePosition[];
  /** Offene Rechnungen, die in Raten bezahlt werden (Ebru komplett + manuelle Positionen aller Lieferanten). */
  ratenPositionen?: LiqManuellePosition[];
  /** Letzte tatsächliche Zahlung je Lieferant (aus den Kontoumsätzen), YYYY-MM-DD. */
  letzteZahlung?: Record<string, string>;
  /** Ratenlieferanten: Ware in Produktion ohne Rechnung und ohne Ankunftsdatum (USD) — nicht im Plan. */
  ratenKommendUsd?: Record<string, number>;
  /** Lieferungen der Ratenlieferanten (Ebru), deren Einfuhrabgaben noch kommen. Fehlt das Feld,
   *  zählt deren EUSt wie früher nur als Ø in der USt (alte Rohdaten). */
  einfuhrAndere?: LiqEinfuhrPosten[];
  /** Bestellrhythmus Ebru (für die Nachbestell-Schätzung). */
  ebruNachbestellung?: { lieferant: string; kgProMonatAuto: number; usdProKgAuto: number; leadWochen: number; kgVerbrauchMonat?: number | null; letzteBestellung?: string | null } | null;
  /** Abbuchungen von DHL (ZIT) / Ungewitter, deren Nummer an keiner Bestellung steht. */
  zollBuchungen?: ZollBuchung[];
  /** An Bestellungen eingetragene Lieferanten-Zahlungen, die noch nicht auf dem Konto stehen. */
  zahlungenUnterwegs?: ZahlungUnterwegs[];
  verschiebungen?: LiqVerschiebungen;
  /** Tage mit Bankzahlungen je Ratenlieferant (neueste zuerst) — verschobene Raten rücken danach vor. */
  ratenZahlTage?: Record<string, string[]>;
  steuern: {
    /** Vergangene Monate: gezahlte USt-VA (+) bzw. Erstattung (−) und im Monat gezahlte EUSt. */
    ustHistorie: Array<{ monat: string; ust: number; eust: number }>;
    /** Letzter Monat, dessen USt-VA bezahlt/erstattet ist. */
    ustErledigtBis: string | null;
    /** Im jeweiligen Monat bereits gezahlte EUSt (aus den Kontoumsätzen). */
    eustBezahlt: Record<string, number>;
    lstLetzte: number[];
    lstErledigtBis: string | null;
    estLetzte: number | null;
    gewstLetzte: number | null;
    /** Bereits bezahlte Quartale, z.B. "est_vz|Q3 2026". */
    quartaleErledigt: string[];
    /** Rechnungsbeträge (USD) der Amanda-Lieferungen je Ankunftsmonat (Vergangenheit) — um die
     *  EUSt der übrigen Lieferanten (Ebru …) aus der Historie herauszurechnen. */
    amandaImportUsd?: Record<string, number>;
    /** Im Steuer-Ledger eingetragenes Soll noch offener Posten, "art|zeitraum" → Betrag
     *  (+ Zahlung, − Erstattung). Hat Vorrang vor der Schätzung (z.B. USt-VA vom Steuerberater). */
    sollOffen?: Record<string, number>;
    /** Schlüssel aus sollOffen, deren Soll nur eine Schätzung ist. */
    sollGeschaetzt?: string[];
    /** Datum aus dem Steuer-Ledger je offenem Soll, "art|zeitraum" → YYYY-MM-DD. */
    sollFaellig?: Record<string, string>;
  };
  nachbestellung: {
    /** Ø bestellte kg/Monat (letzte 3 Monate) — war zuletzt Black-Friday-Vorrat, nicht Verbrauch. */
    kgProMonatAuto: number;
    /** Verkauf Russisch glatt laut Verkaufsanalyse (Ø 3 Monate); null = Sheet nicht erreichbar. */
    kgVerbrauchMonat: number | null;
    usdProKgAuto: number;
    leadWochen: number;
    /** Datum der letzten echten Amanda-Bestellung (Rhythmus der Nachbestellungen läuft ab hier). */
    letzteBestellung?: string | null;
  };
}

// ── Echter Verlauf (Vergangenheit) ──────────────────────────────────────────

/** Zahlungsarten, die sich im Diagramm einzeln einblenden lassen (Vergangenheit + Vorschau). */
export type ZahlGruppe = "amanda" | "ebru" | "einfuhr" | "steuern";

/** Gruppe eines geplanten Termins; null = nicht einzeln darstellbar (z.B. Aktions-Eingänge). */
export function zahlGruppe(ev: Pick<Ereignis, "art">): ZahlGruppe | null {
  if (ev.art === "lieferant" || ev.art === "nachbestellung") return "amanda";
  if (ev.art === "manuell") return "ebru";
  if (ev.art === "einfuhr") return "einfuhr";
  if (ev.art === "steuer") return "steuern";
  return null;
}

export interface VerlaufBuchung {
  iban: string;
  datum: string;
  betrag: number;
  name: string;
  /** Übertrag zwischen den eigenen Konten: ändert die Summe nicht, gehört nicht in die Tagesliste. */
  intern?: boolean;
  gruppe?: ZahlGruppe | null;
}

export interface VerlaufTag {
  datum: string;
  saldo: number;
  /** Größte Buchungen des Tages. */
  buchungen: Array<{ name: string; betrag: number }>;
  weitere: number;
  /** Alle Buchungen des Tages, die zu einer Zahlungsgruppe gehören (fehlt, wenn keine). */
  zahlungen?: Array<{ gruppe: ZahlGruppe; name: string; betrag: number }>;
}

/**
 * Kontostand am Tagesende, rückwärts aus dem heutigen Stand und den Buchungen danach.
 * Beginnt erst, wenn für jedes Konto Buchungen vorliegen — davor wäre die Summe unvollständig.
 */
export function kontoVerlauf(buchungen: VerlaufBuchung[], konten: Array<{ iban: string; saldo: number }>, bis: string, maxProTag = 5): VerlaufTag[] {
  const ersteBuchung = new Map<string, string>();
  const proTag = new Map<string, VerlaufBuchung[]>();
  for (const b of buchungen) {
    if (!ersteBuchung.has(b.iban) || b.datum < (ersteBuchung.get(b.iban) as string)) ersteBuchung.set(b.iban, b.datum);
    proTag.set(b.datum, [...(proTag.get(b.datum) ?? []), b]);
  }
  if (!konten.length || konten.some((k) => !ersteBuchung.has(k.iban))) return [];
  const von = konten.map((k) => ersteBuchung.get(k.iban) as string).sort().at(-1) as string;

  let saldo = konten.reduce((s, k) => s + k.saldo, 0);
  for (const b of buchungen) if (b.datum > von) saldo -= b.betrag;
  const out: VerlaufTag[] = [];
  for (let d = von; d <= bis; d = plusTage(d, 1)) {
    const amTag = proTag.get(d) ?? [];
    if (d > von) saldo += amTag.reduce((s, b) => s + b.betrag, 0);
    const sichtbar = amTag.filter((b) => !b.intern && b.betrag !== 0).sort((a, b) => Math.abs(b.betrag) - Math.abs(a.betrag));
    const zahlungen = amTag.filter((b) => b.gruppe && b.betrag !== 0).map((b) => ({ gruppe: b.gruppe as ZahlGruppe, name: b.name, betrag: b.betrag }));
    out.push({
      datum: d,
      saldo: r2(saldo),
      buchungen: sichtbar.slice(0, maxProTag).map((b) => ({ name: b.name, betrag: b.betrag })),
      weitere: Math.max(0, sichtbar.length - maxProTag),
      ...(zahlungen.length ? { zahlungen } : {}),
    });
  }
  return out;
}

// ── Ereignisse + Prognose ───────────────────────────────────────────────────

export type EreignisArt = "lieferant" | "manuell" | "einfuhr" | "steuer" | "nachbestellung" | "aktion";

export interface Ereignis {
  datum: string;
  betrag: number; // + Eingang, − Ausgang
  art: EreignisArt;
  label: string;
  orderId?: string;
  /** Steuerart für Symbole/Filter (nur art "steuer"). */
  steuer?: "ust" | "lst" | "est" | "gewst";
  /** Betrag beruht auf einer Schätzung (Soll als Schätzung markiert bzw. Modell). */
  schaetzung?: boolean;
  /** Ratenzahlung: welche Rechnungen diese Rate (anteilig) bezahlt. */
  orderIds?: string[];
  sofort?: boolean; // eigentlich schon fällig
  /** Termin wurde von Hand verschoben. */
  verschoben?: boolean;
  /** Ratenzahlung: an welchen Lieferanten. */
  ratenLieferant?: string;
  /** Rate eines Lieferanten: Termin + Schlüssel zum Verschieben. */
  rateTermin?: TerminStand & { lieferant: string; schluessel: string };
  /** Bestellung in Anzahlung + Rest geteilt. */
  teil?: "anzahlung" | "rest";
  /** An der Bestellung als bezahlt eingetragen, aber noch nicht auf dem Konto — keine offene Schuld mehr. */
  unterwegs?: boolean;
}

export type Ampel = "ok" | "knapp" | "luecke";

export interface BestellPrognose {
  orderId: string;
  label: string;
  status: string;
  eta: string | null;
  zahlDatum: string;
  sofort: boolean;
  termin: TerminStand;
  /** Restbetrag 0 → an den Lieferanten nichts mehr zu zahlen (nur noch Einfuhrabgaben). */
  bezahlt: boolean;
  betragUsd: number;
  betragEur: number;
  saldoNachZahlung: number;
  ampel: Ampel;
  fehlbetrag: number; // > 0 bei Lücke/unter Puffer
  einfuhr: { datum: string; eust: number; zoll: number; saldoDanach: number; ampel: Ampel } | null;
  /** Eingetragene DHL-/Zoll-Rechnungsnummer(n) (Rohtext) und ihr Abgleich mit dem Konto. */
  einfuhrRechnung: string | null;
  einfuhrZahlung: EinfuhrZahlung | null;
  /** Ohne eingetragene Nummer: vermutlich passende Abbuchung nach dem Versand (verrechnet). */
  einfuhrVermutung: EinfuhrVermutung | null;
  /** Geplante Anzahlung + Rest; null = ganzer Betrag auf einmal. */
  teilung: Teilung | null;
}

export interface Teilung {
  anzahlungUsd: number;
  anzahlungEur: number;
  anzahlungDatum: string;
  /** Seit dem Planen ist eine Zahlung eingegangen → nur noch der Rest offen. */
  anzahlungBezahlt: boolean;
  restUsd: number;
  restEur: number;
  restDatum: string;
  restAbgelaufenAm: string | null;
}

export interface PrognoseErgebnis {
  start: string;
  fx: number;
  fxQuelle: "auto" | "manuell" | "standard";
  einnahmenProTag: number;
  /** Summe der Flaute nach der Aktion im Vorschau-Zeitraum (negativ). */
  nachlaufSumme: number;
  laufendProTag: number; // negativ
  andereLieferantenProTag: number; // negativ (nur wenn eingerechnet)
  ustBasis: number;
  /** Ø EUSt pro Monat aus Importen anderer Lieferanten (Ebru …), aus der Historie. */
  eustAndereMonat: number;
  /** Ø tatsächliche USt-Zahllast (nach Vorsteuer und EUSt) der Historienmonate. */
  ustIstSchnitt: number | null;
  /** PayPal-Guthaben laut API; eingerechnet = Teil des Startstands. */
  paypal: { saldo: number; stand: string; abgerufenAm: string; eingerechnet: boolean } | null;
  /** Startstand der Rechnung = Sparkasse + ggf. PayPal. */
  startSaldoGesamt: number;
  /** Für die Nachbestell-Schätzung verwendete kg/Monat. */
  nachbestellKgMonat: number;
  tage: Array<{ datum: string; saldo: number }>;
  ereignisse: Ereignis[];
  bestellungen: BestellPrognose[];
  /** Ebru-Lieferungen mit ihren Einfuhrabgaben (Zahlung an den Lieferanten läuft über die Raten). */
  einfuhrAndere: EinfuhrPrognose[];
  /** Für die Ebru-Nachbestell-Schätzung verwendete kg/Monat. */
  ebruNachbestellKgMonat: number;
  tiefpunkt: { datum: string; saldo: number };
  /** Tiefpunkt, wenn andere Lieferanten (Ø) zusätzlich eingerechnet würden — als Warnung. */
  tiefpunktMitAnderen: { datum: string; saldo: number };
  hinweise: string[];
}

export interface EinfuhrPrognose {
  orderId: string;
  label: string;
  lieferant: string;
  status: string;
  eta: string | null;
  warenUsd: number;
  geschaetzt: boolean;
  einfuhr: { datum: string; eust: number; zoll: number; saldoDanach: number; ampel: Ampel } | null;
  einfuhrRechnung: string | null;
  einfuhrZahlung: EinfuhrZahlung | null;
  einfuhrVermutung: EinfuhrVermutung | null;
}

/** Ware ist angekommen: Einfuhrabgaben sind erledigt, ein offener Rest ist sofort fällig. */
export const WARE_DA = ["delivered", "stocked"];
/** Ware ist unterwegs oder da — erst ab hier kommen Zoll-/DHL-Rechnungen. */
const VERSENDET = ["shipped", "in_customs", ...WARE_DA];
/** Noch nicht versendete Ware mit überholtem Datum: Versand frühestens in so vielen Tagen. */
export const VERSAND_FRUEHESTENS_TAGE = 7;
/** Ebru: Rechnung des Verzollers (Carl Ungewitter) ~2–3 Tage nach Versand. */
export const ZOLL_NACH_VERSAND_TAGE = 3;
const SOFORT_STATUS = ["ready_to_ship", "shipped", "in_customs", ...WARE_DA];
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Label-Zusatz + Schätzungs-Merkmal für einen Steuerposten. */
function sollInfo(roh: LiqRohdaten, key: string): { soll: number | undefined; zusatz: string; schaetzung: boolean } {
  const soll = roh.steuern.sollOffen?.[key];
  // Ohne Soll rechnet das Modell — Schätzung, aber ohne Label-Zusatz (Oberfläche zeigt "≈")
  if (soll === undefined) return { soll, zusatz: "", schaetzung: true };
  const geschaetzt = (roh.steuern.sollGeschaetzt ?? []).includes(key);
  return { soll, zusatz: geschaetzt ? " (Schätzung laut Vorauszahlungen)" : " (Soll laut Vorauszahlungen)", schaetzung: geschaetzt };
}

function ampelFuer(saldo: number, puffer: number): Ampel {
  return saldo < 0 ? "luecke" : saldo < puffer ? "knapp" : "ok";
}

interface Plan {
  start: string;
  ende: string;
  fx: number;
  fxQuelle: PrognoseErgebnis["fxQuelle"];
  ereignisse: Ereignis[];
  ustBasis: number;
  bestellInfo: Map<string, { zahlDatum: string; sofort: boolean; termin: TerminStand; usd: number; eur: number; einfuhr: { datum: string; eust: number; zoll: number } | null; teilung: Teilung | null }>;
  hinweise: string[];
  nachbestellKgMonat: number;
  ebruNachbestellKgMonat: number;
  einfuhrAndere: Map<string, { datum: string; eust: number; zoll: number } | null>;
  vermutungen: Map<string, EinfuhrVermutung>;
  /** Tag → Abweichung der Einnahmen vom Ø (Flaute nach der Aktion, negativ). */
  einnahmenKorrektur: Map<string, number>;
  eustAndereMonat: number;
  ustIstSchnitt: number | null;
}

export interface Rate {
  lieferant: string;
  nr: number;
  von: number;
  datum: string;
  usd: number;
  positionen: Array<{ id: string; label: string; usd: number; geschaetzt?: boolean }>;
  termin: TerminStand;
  /** Schlüssel zum Verschieben dieser Rate (rateSchluessel). */
  schluessel: string;
}

/**
 * Verschobener Termin vor Regeltermin. Ist er verstrichen und die Zahlung noch offen, zählt sie
 * wieder als sofort fällig — eine Verschiebung darf nie still aus der Rechnung fallen.
 */
function terminMit(regelDatum: string, v: LiqVerschiebung | undefined, start: string): TerminStand & { datum: string } {
  if (!v) return { datum: regelDatum, regelDatum, verschoben: false, notiz: null, abgelaufenAm: null };
  if (v.datum < start) return { datum: start, regelDatum, verschoben: false, notiz: v.notiz, abgelaufenAm: v.datum };
  return { datum: v.datum, regelDatum, verschoben: true, notiz: v.notiz, abgelaufenAm: null };
}

const deKurz = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}`;

function terminHinweis(name: string, t: TerminStand & { datum: string }, ende: string): string | null {
  if (t.abgelaufenAm) return `${name}: verschobener Termin ${deKurz(t.abgelaufenAm)} ist verstrichen und noch nicht bezahlt — wieder als sofort fällig gerechnet.`;
  if (t.verschoben && t.datum > ende) return `${name}: verschobener Termin ${deKurz(t.datum)} liegt nach dem Vorschau-Zeitraum — die Zahlung fehlt in der Kurve.`;
  return null;
}

/**
 * Ratenplan pro Lieferant, älteste Rechnung zuerst. Rate = rateUsd (letzte = Rest).
 * Termin = max(Rechnungsdatum + Frist, vorige Zahlung + Abstand, start) — "vorige Zahlung" ist
 * zuerst die letzte echte Bankzahlung, danach die jeweils vorige geplante Rate.
 * Eine Rate kann den Rest der einen und den Anfang der nächsten Rechnung abdecken.
 * Jede Rate lässt sich verschieben, die folgenden rechnen ab ihr weiter. Mit jeder echten Bankzahlung
 * seit dem Planen rückt eine Verschiebung eine Rate vor (aus Rate 3 wird Rate 2); die verschobene
 * Rate selbst bezahlt → Verschiebung erledigt.
 */
export function ratenplan(
  positionen: LiqManuellePosition[],
  letzteZahlung: Record<string, string>,
  e: LiqEinstellungen,
  start: string,
  verschiebungen: Record<string, LiqVerschiebung> = {},
  zahlTage: Record<string, string[]> = {},
): Rate[] {
  const out: Rate[] = [];
  const offenAlle = positionen.filter((p) => p.restUsd > 0.01);
  for (const lieferant of [...new Set(offenAlle.map((p) => p.lieferant))]) {
    const cfg = ratenRegelFuer(lieferant, e);
    const offen = offenAlle
      .filter((p) => p.lieferant === lieferant)
      .sort((a, b) => a.datum.localeCompare(b.datum) || a.label.localeCompare(b.label))
      .map((p) => ({ ...p, rest: p.restUsd, faellig: plusTage(p.datum, cfg.fristTage) }));
    const rate = Math.max(1, cfg.rateUsd);
    const raten: Rate[] = [];
    let letzte: string | null = letzteZahlung[lieferant] ?? null;
    // Nächste Rate nach einer Zahlung am Tag l — mit Rhythmuswechsel: ab `wechselAb` neuer Abstand,
    // eine Rate, die nach altem Rhythmus über den Wechseltag hinaus fiele, kommt am Wechseltag.
    const naechste = (l: string) => {
      const w = cfg.wechselAb, a2 = cfg.abstandTageAb;
      if (!w || !a2 || a2 < 1) return plusTage(l, cfg.abstandTage);
      if (l >= w) return plusTage(l, a2);
      const n = plusTage(l, cfg.abstandTage);
      return n > w ? w : n;
    };
    const jetzt = ratenVerschiebungenJetzt(verschiebungen, lieferant, zahlTage[lieferant], letzte);
    for (let kopf = 0; kopf < offen.length && raten.length < 200; ) {
      const frueh: string = letzte ? naechste(letzte) : offen[kopf].faellig;
      let datum: string = frueh > offen[kopf].faellig ? frueh : offen[kopf].faellig;
      if (datum < start) datum = start;
      const t = terminMit(datum, jetzt.get(raten.length + 1), start);
      datum = t.datum;
      const termin: TerminStand = { regelDatum: t.regelDatum, verschoben: t.verschoben, notiz: t.notiz, abgelaufenAm: t.abgelaufenAm };
      let usd = 0;
      const pos: Rate["positionen"] = [];
      while (kopf < offen.length && usd < rate - 0.005) {
        const teil = Math.min(offen[kopf].rest, rate - usd);
        usd += teil;
        offen[kopf].rest -= teil;
        pos.push({ id: offen[kopf].id, label: offen[kopf].label, usd: r2(teil), ...(offen[kopf].geschaetzt ? { geschaetzt: true } : {}) });
        if (offen[kopf].rest <= 0.005) kopf++;
      }
      raten.push({ lieferant, nr: raten.length + 1, von: 0, datum, usd: r2(usd), positionen: pos, termin, schluessel: rateSchluessel(lieferant, raten.length + 1) });
      letzte = datum;
    }
    for (const r of raten) out.push({ ...r, von: raten.length });
  }
  return out;
}

/**
 * Bestelltage künftiger Nachbestellungen: alle `abstand` Tage ab der letzten echten Bestellung.
 * Ist der nächste Termin schon vorbei (Bestellung überfällig), wird ab heute bestellt. Ohne letzte
 * Bestellung: ab dem nächsten Montag.
 */
export function bestellTage(letzte: string | null | undefined, start: string, ende: string, abstand: number): string[] {
  const schritt = Math.max(1, Math.round(abstand));
  let d: string;
  if (letzte) {
    d = plusTage(letzte, schritt);
    if (d < start) d = start;
  } else {
    d = start;
    while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 1) d = plusTage(d, 1);
  }
  const out: string[] = [];
  for (; d <= ende && out.length < 400; d = plusTage(d, schritt)) out.push(d);
  return out;
}

/** Schlüssel einer Rate zum Verschieben: Rate 1 = Lieferantenname (wie früher), sonst "Lieferant#nr". */
export function rateSchluessel(lieferant: string, nr: number): string {
  return nr <= 1 ? lieferant : `${lieferant}#${nr}`;
}

export function zerlegeRateSchluessel(s: string): { lieferant: string; nr: number } {
  const m = s.match(/^(.*)#(\d+)$/);
  return m ? { lieferant: m[1], nr: Number(m[2]) } : { lieferant: s, nr: 1 };
}

/**
 * Verschiebungen eines Lieferanten auf die heutige Ratennummer: jeder Zahltag nach dem Planen rückt
 * eins vor, ≤ 0 = schon bezahlt. Ohne Zahltage-Liste gilt nur "keine neue Zahlung seit dem Planen".
 * Zeigen zwei auf dieselbe Rate, gewinnt die zuletzt geplante.
 */
export function ratenVerschiebungenJetzt(
  verschiebungen: Record<string, LiqVerschiebung>,
  lieferant: string,
  zahlTage: string[] | undefined,
  letzte: string | null,
): Map<number, LiqVerschiebung & { schluessel: string }> {
  const out = new Map<number, LiqVerschiebung & { schluessel: string }>();
  for (const [schluessel, v] of Object.entries(verschiebungen)) {
    const k = zerlegeRateSchluessel(schluessel);
    if (k.lieferant !== lieferant) continue;
    const basis = v.basisZahlung ?? "";
    const n = zahlTage ? new Set(zahlTage.filter((d) => d > basis)).size : (letzte ?? "") > basis ? Infinity : 0;
    const nr = k.nr - n;
    if (nr < 1) continue;
    const alt = out.get(nr);
    if (!alt || (alt.basisZahlung ?? "") < basis) out.set(nr, { ...v, schluessel });
  }
  return out;
}

export function erstellePlan(roh: LiqRohdaten, e: LiqEinstellungen): Plan {
  const start = plusTage(roh.saldoStand, 1) > roh.heute ? roh.heute : plusTage(roh.saldoStand, 1);
  const ende = plusTage(start, e.horizontTage);
  const hinweise: string[] = [];
  const fx = e.fxUsdProEur ?? roh.fxAuto?.kurs ?? 1.1;
  const fxQuelle: PrognoseErgebnis["fxQuelle"] = e.fxUsdProEur ? "manuell" : roh.fxAuto ? "auto" : "standard";
  if (fxQuelle === "standard") hinweise.push("Kein Wechselkurs in den Kontoumsätzen gefunden — Standard 1,10 USD/€ verwendet.");
  const amStart = (d: string) => (d < start ? start : d);
  const ereignisse: Ereignis[] = [];
  const bestellInfo: Plan["bestellInfo"] = new Map();
  const eustProMonat: Record<string, number> = { ...roh.steuern.eustBezahlt };

  const einfuhrFuer = (usd: number, importVatEur: number | null) => {
    const warenwert = (usd / fx) * (1 + e.frachtProzent / 100);
    const zoll = warenwert * (e.zollSatz / 100);
    const eust = importVatEur ?? (warenwert + zoll) * (e.eustSatz / 100);
    return { zoll: r2(zoll), eust: r2(eust) };
  };

  // Einfuhrabgaben einer Lieferung: ohne Rechnungsnummer bis die Ware angekommen ist (Status). Mit
  // Rechnungsnummer zählt das Konto — erst die Abbuchung erledigt sie, auch wenn die Ware schon eingelagert ist.
  // Schon abgebuchte, aber nicht zugeordnete Verzoller-Rechnungen: gegen verschickte Ware ohne Nummer
  // verrechnen (sonst steckt der Betrag im Kontostand UND als Zahlung "heute" in der Vorschau).
  const UNTERWEGS = ["shipped", "in_customs"];
  const ebruEinzelnVorab = roh.einfuhrAndere !== undefined && !e.andereLieferantenEinrechnen;
  const vermutungen = new Map<string, EinfuhrVermutung>();
  if (e.zollAbbuchungenVerrechnen && roh.zollBuchungen?.length) {
    const kand = (b: { id: string; status: string; versandAm?: string | null; einfuhrRechnung?: string | null; importVatEur: number | null }, usd: number, art: ZollBuchung["art"]) => {
      if (!UNTERWEGS.includes(b.status) || !b.versandAm || rechnungsNummern(b.einfuhrRechnung).length || usd <= 0) return [];
      const ab = einfuhrFuer(usd, b.importVatEur);
      return [{ id: b.id, art, versandAm: b.versandAm, eur: r2(ab.eust + ab.zoll) }];
    };
    const kandidaten = [
      ...roh.bestellungen.flatMap((b) => kand(b, b.invoiceUsd ?? 0, "dhl")),
      ...(ebruEinzelnVorab ? roh.einfuhrAndere ?? [] : []).flatMap((b) => kand(b, b.warenUsd, "ungewitter")),
    ];
    for (const [id, v] of zollVermutungen(kandidaten, roh.zollBuchungen)) vermutungen.set(id, v);
  }

  // Termin: Amanda (DHL-ZIT) bei Ankunft; Ebru (Ungewitter) wenige Tage nach Versand, Versand = Ankunft − Vorlauf
  // wie bei der Ebru-Rechnung. Noch nicht versendete Ware mit überholtem Datum kann nicht heute ankommen →
  // Versand/Ankunft frühestens in VERSAND_FRUEHESTENS_TAGE.
  const einfuhrDatum = (b: { status: string; eta: string | null }, termin: "ankunft" | "versand") => {
    // Schon versendet: echter Versandtag liegt zurück → keine Untergrenze außer heute
    const frueh = VERSENDET.includes(b.status) ? "" : plusTage(start, VERSAND_FRUEHESTENS_TAGE);
    const max = (a: string, c: string) => (a > c ? a : c);
    if (termin === "ankunft") return amStart(max(b.eta ?? start, frueh));
    const versand = max(b.eta ? plusTage(b.eta, -e.zahlungVorAnkunftTage) : start, frueh);
    return amStart(plusTage(versand, ZOLL_NACH_VERSAND_TAGE));
  };
  const planeEinfuhr = (b: { id: string; label: string; status: string; eta: string | null; warenUsd: number; importVatEur: number | null; einfuhrZahlung?: EinfuhrZahlung | null }, termin: "ankunft" | "versand") => {
    const ez = b.einfuhrZahlung ?? null;
    const ezErledigt = !!ez && ez.gefunden.length === ez.rechnungen.length;
    if (ezErledigt || (WARE_DA.includes(b.status) && !ez) || b.warenUsd <= 0) return null;
    const ab = einfuhrFuer(b.warenUsd, b.importVatEur);
    // Teil schon abgebucht (mehrere Rechnungen): nur der Rest; bei Sammelzahlungen ist der Anteil unbekannt
    const summe = ab.eust + ab.zoll;
    const vm = vermutungen.get(b.id);
    const schon = ez && !ez.sammel ? Math.min(ez.betragEur, summe) : vm ? Math.min(vm.anteilEur, summe) : 0;
    const f = summe > 0 ? 1 - schon / summe : 0;
    const rest = { eust: r2(ab.eust * f), zoll: r2(ab.zoll * f) };
    if (rest.eust + rest.zoll <= 0.005) return null;
    const datum = einfuhrDatum(b, termin);
    ereignisse.push({ datum, betrag: -r2(rest.eust + rest.zoll), art: "einfuhr", label: `Einfuhrabgaben ${b.label}`, orderId: b.id });
    eustProMonat[monatVon(datum)] = (eustProMonat[monatVon(datum)] ?? 0) + rest.eust;
    return { datum, ...rest };
  };

  // 0) Eingetragene Zahlungen, die das Konto noch nicht zeigt: Rest der Bestellung ist schon kleiner,
  //    der Kontostand aber noch nicht → heute abziehen, bis die Abbuchung kommt.
  for (const z of roh.zahlungenUnterwegs ?? []) {
    ereignisse.push({
      datum: amStart(z.datum),
      betrag: -r2(z.usd / fx),
      art: z.art === "amanda" ? "lieferant" : "manuell",
      label: `${z.label} · bezahlt ${deKurz(z.datum)}, noch nicht auf dem Konto`,
      orderId: z.orderId,
      ...(z.art === "raten" ? { ratenLieferant: z.lieferant } : {}),
      unterwegs: true,
    });
  }

  // 1) Amanda-Bestellungen: Zahlung bei "versandbereit" (≈ Ankunft − X Tage), Einfuhrabgaben bei Ankunft
  for (const b of roh.bestellungen) {
    const bezahlt = b.restUsd <= 0.01;
    const sofortRegel = !bezahlt && (SOFORT_STATUS.includes(b.status) || (!!b.eta && plusTage(b.eta, -e.zahlungVorAnkunftTage) < start));
    const regelDatum = SOFORT_STATUS.includes(b.status) || !b.eta ? start : amStart(plusTage(b.eta, -e.zahlungVorAnkunftTage));
    const v = bezahlt ? undefined : roh.verschiebungen?.bestellungen[b.id];
    const t = terminMit(regelDatum, v, start);
    const eur = r2(b.restUsd / fx);
    if (!b.eta && !bezahlt) hinweise.push(`${b.label}: kein Ankunftsdatum — Zahlung sofort angenommen.`);
    // Anzahlung + Rest: jede Zahlung seit dem Planen zählt als Anzahlung, danach ist nur noch der Rest offen
    let teilung: Teilung | null = null;
    if (v?.anzahlungUsd && v.anzahlungUsd > 0 && v.restDatum) {
      const anzahlungBezahlt = v.restBasisUsd != null && b.restUsd < v.restBasisUsd - 0.01;
      const anzUsd = anzahlungBezahlt ? 0 : Math.min(v.anzahlungUsd, b.restUsd);
      const tRest = terminMit(regelDatum, { datum: v.restDatum, notiz: v.notiz }, start);
      const restDatum = !anzahlungBezahlt && tRest.datum < t.datum ? t.datum : tRest.datum;
      teilung = {
        anzahlungUsd: r2(anzahlungBezahlt ? v.anzahlungUsd : anzUsd),
        anzahlungEur: r2((anzahlungBezahlt ? v.anzahlungUsd : anzUsd) / fx),
        anzahlungDatum: t.datum,
        anzahlungBezahlt,
        restUsd: r2(b.restUsd - anzUsd),
        restEur: r2((b.restUsd - anzUsd) / fx),
        restDatum,
        restAbgelaufenAm: tRest.abgelaufenAm,
      };
      if (!anzahlungBezahlt) {
        const h = terminHinweis(`${b.label} (Anzahlung)`, t, ende);
        if (h) hinweise.push(h);
        ereignisse.push({ datum: t.datum, betrag: -teilung.anzahlungEur, art: "lieferant", label: `${b.label} · Anzahlung`, orderId: b.id, sofort: !!t.abgelaufenAm, verschoben: true, teil: "anzahlung" });
      }
      if (teilung.restUsd > 0.01) {
        const h = terminHinweis(`${b.label} (Rest)`, tRest, ende);
        if (h) hinweise.push(h);
        ereignisse.push({ datum: restDatum, betrag: -teilung.restEur, art: "lieferant", label: `${b.label} · Rest`, orderId: b.id, sofort: !!tRest.abgelaufenAm, verschoben: true, teil: "rest" });
      }
    } else {
      const hinweis = terminHinweis(b.label, t, ende);
      if (hinweis) hinweise.push(hinweis);
    }
    const sofort = teilung
      ? !!(teilung.anzahlungBezahlt ? teilung.restAbgelaufenAm : t.abgelaufenAm)
      : t.verschoben ? false : !!t.abgelaufenAm || sofortRegel;
    const zahlDatum = teilung?.anzahlungBezahlt ? teilung.restDatum : t.datum;
    if (!bezahlt && !teilung) {
      ereignisse.push({ datum: zahlDatum, betrag: -eur, art: "lieferant", label: b.label, orderId: b.id, sofort, verschoben: t.verschoben });
    }
    const einfuhr = planeEinfuhr({ ...b, warenUsd: b.invoiceUsd ?? 0 }, "ankunft");
    const termin = { regelDatum: t.regelDatum, verschoben: t.verschoben, notiz: t.notiz, abgelaufenAm: t.abgelaufenAm };
    bestellInfo.set(b.id, { zahlDatum, sofort, termin, usd: b.restUsd, eur, einfuhr, teilung });
  }

  // 1a) Ebru-Lieferungen: Einfuhrabgaben kurz nach Versand (Ungewitter), die Ware selbst läuft über die Raten.
  //     Mit dem Lieferanten-Ø aus der Bank stecken sie schon dort drin → dann nicht einzeln.
  const ebruEinzeln = roh.einfuhrAndere !== undefined && !e.andereLieferantenEinrechnen;
  const einfuhrAndere: Plan["einfuhrAndere"] = new Map();
  if (ebruEinzeln) {
    for (const b of roh.einfuhrAndere ?? []) {
      const ab = planeEinfuhr(b, "versand");
      if (b.eta && b.eta < start && !VERSENDET.includes(b.status)) {
        hinweise.push(`${b.label}: Ankunft ${deKurz(b.eta)} ist vorbei, aber noch nicht versendet — Versand frühestens in ${VERSAND_FRUEHESTENS_TAGE} Tagen angenommen${ab ? `, Einfuhrabgaben ca. ${deKurz(ab.datum)}` : ""}. Bitte Ankunftsdatum an der Bestellung aktualisieren.`);
      }
      einfuhrAndere.set(b.id, ab);
    }
  }

  // 1a') Künftige Ebru-Nachbestellungen (Schätzung): im Bestellrhythmus ab der letzten Bestellung, Rechnung bei Versand
  const ebruNb = roh.ebruNachbestellung ?? null;
  // Nachbestellt wird nach Verbrauch (Usbekisch wellig laut Verkaufsanalyse), sonst Ø Bestellungen
  const ebruNachbestellKgMonat = e.ebruNachbestellKgMonat ?? ebruNb?.kgVerbrauchMonat ?? ebruNb?.kgProMonatAuto ?? 0;
  const nbPositionen: LiqManuellePosition[] = [];
  if (e.ebruNachbestellungenEinrechnen && ebruNb && ebruEinzeln) {
    const usdKg = e.ebruUsdProKg ?? ebruNb.usdProKgAuto;
    const kgBestellung = (ebruNachbestellKgMonat * 12 * e.nachbestellAbstandTage) / 365;
    if (kgBestellung <= 0 || usdKg <= 0) hinweise.push("Ebru-Nachbestellungen: keine kg/Monat oder kein Preis pro kg — nicht eingerechnet.");
    else {
      for (const d of bestellTage(ebruNb.letzteBestellung, start, ende, e.nachbestellAbstandTage)) {
        const usd = r2(kgBestellung * usdKg);
        const ankunft = plusTage(d, ebruNb.leadWochen * 7);
        const rechnung = plusTage(ankunft, -e.zahlungVorAnkunftTage);
        const label = `Ebru-Nachbestellung ~${kgBestellung.toFixed(1)} kg (bestellt ${deKurz(d)})`;
        if (rechnung <= ende) nbPositionen.push({ id: `nb-ebru-${d}`, label, lieferant: ebruNb.lieferant, datum: rechnung, restUsd: usd, geschaetzt: true });
        // Verzoller-Rechnung kurz nach Versand (Versand = Rechnung von Ebru)
        const zoll = plusTage(rechnung, ZOLL_NACH_VERSAND_TAGE);
        if (zoll <= ende) {
          const ab = einfuhrFuer(usd, null);
          ereignisse.push({ datum: zoll, betrag: -r2(ab.eust + ab.zoll), art: "einfuhr", label: `Einfuhrabgaben Ebru-Nachbestellung ${deKurz(d)}`, schaetzung: true });
          eustProMonat[monatVon(zoll)] = (eustProMonat[monatVon(zoll)] ?? 0) + ab.eust;
        }
      }
    }
  }

  // 1b) Ratenzahlung (Ebru: alle offenen Rechnungen; andere Lieferanten: nur manuelle Positionen)
  const ratenPos = [...(roh.ratenPositionen ?? roh.manuellePositionen ?? []), ...nbPositionen].filter((p) => p.restUsd > 0.01);
  for (const r of ratenplan(ratenPos, roh.letzteZahlung ?? {}, e, start, roh.verschiebungen?.raten, roh.ratenZahlTage)) {
    const hinweis = terminHinweis(`${r.lieferant} Rate ${r.nr}`, { ...r.termin, datum: r.datum }, ende);
    if (hinweis) hinweise.push(hinweis);
    ereignisse.push({
      datum: r.datum,
      betrag: -r2(r.usd / fx),
      art: "manuell",
      label: `${r.lieferant} Rate ${r.nr}/${r.von} · ${r.usd.toLocaleString("de-DE", { maximumFractionDigits: 0 })} $ (${r.positionen.map((x) => (x.geschaetzt ? `≈ ${x.label}` : x.label)).join(", ")})`,
      ...(r.positionen.some((x) => x.geschaetzt) ? { schaetzung: true } : {}),
      orderIds: r.positionen.map((x) => x.id),
      sofort: !r.termin.verschoben && r.datum <= start,
      verschoben: r.termin.verschoben,
      ratenLieferant: r.lieferant,
      rateTermin: { ...r.termin, lieferant: r.lieferant, schluessel: r.schluessel },
    });
  }
  if (ratenPos.length && e.andereLieferantenEinrechnen) {
    hinweise.push("Ebru-Raten sind eingeplant UND andere Lieferanten als Ø eingerechnet — Ebru-Zahlungen zählen dadurch doppelt.");
  }

  // 2) Künftige Nachbestellungen (Schätzung): im Bestellrhythmus ab der letzten Amanda-Bestellung
  const nachbestellKgMonat = e.nachbestellKgMonat ?? roh.nachbestellung.kgVerbrauchMonat ?? roh.nachbestellung.kgProMonatAuto;
  if (e.nachbestellungenEinrechnen) {
    const kgMonat = nachbestellKgMonat;
    const usdKg = e.usdProKg ?? roh.nachbestellung.usdProKgAuto;
    const leadTage = roh.nachbestellung.leadWochen * 7;
    const kgBestellung = (kgMonat * 12 * e.nachbestellAbstandTage) / 365;
    for (const d of bestellTage(roh.nachbestellung.letzteBestellung, start, ende, e.nachbestellAbstandTage)) {
      const usd = kgBestellung * usdKg;
      const zahl = plusTage(d, leadTage - e.zahlungVorAnkunftTage);
      const ankunft = plusTage(d, leadTage);
      if (zahl <= ende) ereignisse.push({ datum: zahl, betrag: -r2(usd / fx), art: "nachbestellung", label: `Amanda-Nachbestellung ~${kgBestellung.toFixed(1)} kg (bestellt ${deKurz(d)})` });
      if (ankunft <= ende) {
        const ab = einfuhrFuer(usd, null);
        ereignisse.push({ datum: ankunft, betrag: -(ab.eust + ab.zoll), art: "einfuhr", label: `Einfuhrabgaben Amanda-Nachbestellung ${deKurz(d)}` });
        eustProMonat[monatVon(ankunft)] = (eustProMonat[monatVon(ankunft)] ?? 0) + ab.eust;
      }
    }
  }

  // 2b) Verkaufsaktion (Black Friday): Mehrumsatz nach Tagesprofil, Gutschrift nach Auszahlungsverzug.
  //     Die USt auf den Mehrumsatz erhöht die USt-VA des Aktionsmonats.
  const ustZusatz: Record<string, number> = {};
  const a = e.aktion;
  if (a && a.aktiv && a.mehrumsatzBrutto > 0 && a.von <= a.bis) {
    const tage = tageZwischen(a.von, a.bis) + 1;
    const profil = a.profil.length === tage && a.profil.some((x) => x > 0) ? a.profil.map((x) => Math.max(0, x)) : Array(tage).fill(1);
    const summe = profil.reduce((s, x) => s + x, 0);
    for (let i = 0; i < tage; i++) {
      const tag = plusTage(a.von, i);
      const brutto = (a.mehrumsatzBrutto * profil[i]) / summe;
      if (brutto <= 0) continue;
      const eingang = plusTage(tag, a.verzugTage);
      if (eingang >= start && eingang <= ende) {
        ereignisse.push({ datum: eingang, betrag: r2((brutto * a.auszahlungProzent) / 100), art: "aktion", label: `${a.label} Mehrumsatz ${tag.slice(8, 10)}.${tag.slice(5, 7)}.` });
      }
      ustZusatz[monatVon(tag)] = (ustZusatz[monatVon(tag)] ?? 0) + (brutto * 19) / 119;
    }
  }
  // 2c) Flaute nach der Aktion: Kunden haben vorgezogen gekauft → weniger Einnahmen (und weniger USt)
  const einnahmenKorrektur = new Map<string, number>();
  const nl = a?.nachlauf;
  if (nl?.aktiv) {
    const normal = roh.basis.einnahmen / Math.max(1, roh.basis.tage);
    for (const ab of nl.abschnitte) {
      if (!(ab.faktor >= 0) || ab.von > ab.bis) continue;
      for (let d = ab.von < start ? start : ab.von; d <= ab.bis && d <= ende; d = plusTage(d, 1)) {
        const fehl = normal * (ab.faktor - 1);
        einnahmenKorrektur.set(d, r2((einnahmenKorrektur.get(d) ?? 0) + fehl));
        ustZusatz[monatVon(d)] = (ustZusatz[monatVon(d)] ?? 0) + (fehl * 19) / 119;
      }
    }
  }

  // 3) Umsatzsteuer: Zahllast = Basis (USt auf Umsätze − Inlands-Vorsteuer) − EUSt des Monats.
  //    EUSt eines vergangenen Monats = tatsächlich gezahlt (alle Lieferanten). Laufender/künftiger
  //    Monat = gezahlt + Amanda-Ankünfte (einzeln) + Ø EUSt der übrigen Lieferanten (Ebru …) aus der
  //    Historie — so landet ein Normalmonat bei der tatsächlichen Ø Zahllast (2026: ~18,4k).
  //    Mit Dauerfristverlängerung fällig am 10. des übernächsten Monats; Erstattungen ~3 Wochen später.
  const hist = roh.steuern.ustHistorie.filter((h) => Number.isFinite(h.ust));
  const ustBasis = e.ustBasisMonat ?? (hist.length ? r2(hist.reduce((s, h) => s + h.ust + h.eust, 0) / hist.length) : 0);
  const amandaEustHist = (m: string) => {
    const usd = roh.steuern.amandaImportUsd?.[m] ?? 0;
    return usd > 0 ? einfuhrFuer(usd, null).eust : 0;
  };
  const eustAndereMonat = hist.length ? r2(hist.reduce((s, h) => s + Math.max(0, h.eust - amandaEustHist(h.monat)), 0) / hist.length) : 0;
  const ustIstSchnitt = hist.length ? r2(hist.reduce((s, h) => s + h.ust, 0) / hist.length) : null;
  const aktMonat = monatVon(roh.heute);
  if (!e.ustBasisMonat && !hist.length) hinweise.push("Keine USt-Historie — Umsatzsteuer nicht eingerechnet (Basis in den Einstellungen setzen).");
  if (ustBasis !== 0) {
    let m = roh.steuern.ustErledigtBis ? naechsterMonat(roh.steuern.ustErledigtBis) : monatVon(start);
    for (let i = 0; i < 24; i++, m = naechsterMonat(m)) {
      const faellig = faelligkeit("ust_va", m);
      if (!faellig || faellig > ende) break;
      // Ebru einzeln geplant → deren EUSt steckt schon in eustProMonat, kein Ø obendrauf
      const eustAndere = m >= aktMonat && !ebruEinzeln ? eustAndereMonat : 0;
      const si = sollInfo(roh, `ust_va|${m}`);
      const soll = si.soll;
      const betrag = soll !== undefined ? r2(soll) : r2(ustBasis + (ustZusatz[m] ?? 0) - (eustProMonat[m] ?? 0) - eustAndere);
      // Erstattung: von Hand eingetragener Eingangstermin, sonst ca. 3 Wochen nach dem Termin
      const eingetragen = roh.steuern.sollFaellig?.[`ust_va|${m}`];
      const datum = betrag >= 0 ? faellig : eingetragen && eingetragen !== faellig ? eingetragen : plusTage(faellig, 21);
      if (datum > ende) continue;
      ereignisse.push({
        datum: amStart(datum),
        betrag: -betrag,
        art: "steuer",
        label: (betrag < 0 ? `USt-Erstattung ${m} (EUSt-Verrechnung)` : `USt-VA ${m}`) + si.zusatz,
        sofort: datum < start,
        steuer: "ust",
        schaetzung: si.schaetzung,
      });
    }
  }

  // 4) Lohnsteuer: Ø der letzten Anmeldungen, fällig am 10. des Folgemonats
  if (roh.steuern.lstLetzte.length) {
    const lst = r2(roh.steuern.lstLetzte.reduce((s, x) => s + x, 0) / roh.steuern.lstLetzte.length);
    let m = roh.steuern.lstErledigtBis ? naechsterMonat(roh.steuern.lstErledigtBis) : monatVon(start);
    for (let i = 0; i < 24; i++, m = naechsterMonat(m)) {
      const faellig = faelligkeit("lst_anmeldung", m);
      if (!faellig || faellig > ende) break;
      const si = sollInfo(roh, `lst_anmeldung|${m}`);
      ereignisse.push({
        datum: amStart(faellig),
        betrag: -(si.soll ?? lst),
        art: "steuer",
        label: `Lohnsteuer ${m}${si.zusatz}`,
        sofort: faellig < start,
        steuer: "lst",
        schaetzung: si.schaetzung,
      });
    }
  }

  // 5) ESt-/GewSt-Vorauszahlungen: letzter Betrag je Quartal
  const [sy] = start.split("-").map(Number);
  for (const jahr of [sy, sy + 1]) {
    for (let q = 1; q <= 4; q++) {
      for (const [art, betrag, name] of [
        ["est_vz", roh.steuern.estLetzte, "ESt-Vorauszahlung"],
        ["gewst_vz", roh.steuern.gewstLetzte, "GewSt-Vorauszahlung"],
      ] as const) {
        const zeitraum = `Q${q} ${jahr}`;
        const faellig = faelligkeit(art, zeitraum);
        const si = sollInfo(roh, `${art}|${zeitraum}`);
        // Ohne Soll = letzter Bescheidbetrag (Vorauszahlungen sind festgesetzt, keine echte Schätzung)
        const wert = si.soll ?? betrag;
        if (!wert || !faellig || faellig < start || faellig > ende) continue;
        if (roh.steuern.quartaleErledigt.includes(`${art}|${zeitraum}`)) continue;
        ereignisse.push({
          datum: faellig,
          betrag: -wert,
          art: "steuer",
          label: `${name} ${zeitraum}${si.soll !== undefined ? si.zusatz : ""}`,
          steuer: art === "est_vz" ? "est" : "gewst",
          schaetzung: si.soll !== undefined && si.schaetzung,
        });
      }
    }
  }

  // Innerhalb eines Tages: Eingänge vor Ausgängen, sonst stabil
  ereignisse.sort((a, b) => a.datum.localeCompare(b.datum) || Math.sign(b.betrag) - Math.sign(a.betrag));
  return { start, ende, fx, fxQuelle, ereignisse, ustBasis, eustAndereMonat, ustIstSchnitt, bestellInfo, hinweise, nachbestellKgMonat, ebruNachbestellKgMonat, einfuhrAndere, vermutungen, einnahmenKorrektur };
}

function simuliere(
  startSaldo: number,
  start: string,
  ende: string,
  proTag: number,
  ereignisse: Ereignis[],
  korrektur: Map<string, number> = new Map(),
): { tage: Array<{ datum: string; saldo: number }>; nachEreignis: Map<Ereignis, number>; tiefpunkt: { datum: string; saldo: number } } {
  const tage: Array<{ datum: string; saldo: number }> = [];
  const nachEreignis = new Map<Ereignis, number>();
  let saldo = startSaldo;
  let tief = { datum: start, saldo: startSaldo };
  let i = 0;
  for (let d = start; d <= ende; d = plusTage(d, 1)) {
    saldo += proTag + (korrektur.get(d) ?? 0);
    while (i < ereignisse.length && ereignisse[i].datum === d) {
      saldo += ereignisse[i].betrag;
      nachEreignis.set(ereignisse[i], saldo);
      if (saldo < tief.saldo) tief = { datum: d, saldo };
      i++;
    }
    if (saldo < tief.saldo) tief = { datum: d, saldo };
    tage.push({ datum: d, saldo: r2(saldo) });
  }
  return { tage, nachEreignis, tiefpunkt: { datum: tief.datum, saldo: r2(tief.saldo) } };
}

export function prognose(roh: LiqRohdaten, eIn: Partial<LiqEinstellungen> | null | undefined): PrognoseErgebnis {
  const e = mitDefaults(eIn);
  const plan = erstellePlan(roh, e);
  const tage = Math.max(1, roh.basis.tage);
  const einnahmenProTag = r2(roh.basis.einnahmen / tage);
  const aus = new Set(e.ausgeblendeteKategorien);
  const laufendProTag = r2(roh.basis.laufend.filter((x) => !aus.has(x.kategorie)).reduce((s, x) => s + x.summe, 0) / tage);
  const andereProTag = r2(roh.basis.andereLieferanten / tage);
  // Andere Lieferanten (Ebru …): Ware UND deren Einfuhrabgaben — die EUSt-Rückholung steckt schon in der USt
  const andereGesamtProTag = andereProTag - (plan.eustAndereMonat * 12) / 365;
  const proTag = einnahmenProTag + laufendProTag + (e.andereLieferantenEinrechnen ? andereGesamtProTag : 0);

  // PayPal-Guthaben = verkaufte, noch nicht überwiesene Ware → verfügbar. Nur mit frischem Stand
  // (≤ 2 Tage), sonst würde ein veralteter Wert die Vorschau schönrechnen.
  const pp = (roh.bankSalden ?? []).find((b) => b.iban === "PAYPAL") ?? null;
  const ppFrisch = !!pp && tageZwischen(pp.abgerufenAm.slice(0, 10), roh.heute) <= 2;
  const ppEin = !!pp && ppFrisch && e.paypalEinrechnen;
  if (pp && !ppFrisch) plan.hinweise.push(`PayPal-Stand ist vom ${pp.abgerufenAm.slice(0, 10)} — nicht eingerechnet (Worker/PayPal-API prüfen).`);
  const startSaldo = roh.startSaldo + (ppEin && pp ? pp.saldo : 0);

  const sim = simuliere(startSaldo, plan.start, plan.ende, proTag, plan.ereignisse, plan.einnahmenKorrektur);
  const simAndere = e.andereLieferantenEinrechnen
    ? sim
    : simuliere(startSaldo, plan.start, plan.ende, proTag + andereGesamtProTag, plan.ereignisse, plan.einnahmenKorrektur);

  const bestellungen: BestellPrognose[] = [];
  for (const b of roh.bestellungen) {
    const info = plan.bestellInfo.get(b.id);
    if (!info) continue;
    // Bei Anzahlung + Rest zählt die knappere der beiden Zahlungen
    const zahlEvs = plan.ereignisse.filter((x) => x.orderId === b.id && x.art === "lieferant" && !x.unterwegs);
    const einfEv = plan.ereignisse.find((x) => x.orderId === b.id && x.art === "einfuhr");
    const saldoNach = zahlEvs.length ? Math.min(...zahlEvs.map((x) => sim.nachEreignis.get(x) ?? startSaldo)) : startSaldo;
    const ampel = zahlEvs.length ? ampelFuer(saldoNach, e.puffer) : "ok";
    const einfSaldo = einfEv ? sim.nachEreignis.get(einfEv) ?? saldoNach : null;
    bestellungen.push({
      orderId: b.id,
      label: b.label,
      status: b.status,
      eta: b.eta,
      zahlDatum: info.zahlDatum,
      sofort: info.sofort,
      termin: info.termin,
      bezahlt: info.usd <= 0.01,
      betragUsd: info.usd,
      betragEur: info.eur,
      saldoNachZahlung: r2(saldoNach),
      ampel,
      fehlbetrag: r2(Math.max(0, (ampel === "luecke" ? 0 : e.puffer) - saldoNach)),
      einfuhr: info.einfuhr && einfSaldo !== null
        ? { ...info.einfuhr, saldoDanach: r2(einfSaldo), ampel: ampelFuer(einfSaldo, e.puffer) }
        : null,
      einfuhrRechnung: b.einfuhrRechnung ?? null,
      einfuhrZahlung: b.einfuhrZahlung ?? null,
      einfuhrVermutung: plan.vermutungen.get(b.id) ?? null,
      teilung: info.teilung,
    });
  }

  const einfuhrAndere: EinfuhrPrognose[] = [];
  for (const b of roh.einfuhrAndere ?? []) {
    if (!plan.einfuhrAndere.has(b.id)) continue;
    const ab = plan.einfuhrAndere.get(b.id) ?? null;
    const ev = ab ? plan.ereignisse.find((x) => x.orderId === b.id && x.art === "einfuhr") : undefined;
    const saldo = ev ? sim.nachEreignis.get(ev) ?? startSaldo : null;
    einfuhrAndere.push({
      orderId: b.id,
      label: b.label,
      lieferant: b.lieferant,
      status: b.status,
      eta: b.eta,
      warenUsd: b.warenUsd,
      geschaetzt: b.geschaetzt,
      einfuhr: ab && saldo !== null ? { ...ab, saldoDanach: r2(saldo), ampel: ampelFuer(saldo, e.puffer) } : null,
      einfuhrRechnung: b.einfuhrRechnung ?? null,
      einfuhrZahlung: b.einfuhrZahlung ?? null,
      einfuhrVermutung: plan.vermutungen.get(b.id) ?? null,
    });
  }

  return {
    start: plan.start,
    fx: plan.fx,
    fxQuelle: plan.fxQuelle,
    einnahmenProTag,
    nachlaufSumme: r2([...plan.einnahmenKorrektur.values()].reduce((s, x) => s + x, 0)),
    laufendProTag,
    andereLieferantenProTag: r2(andereGesamtProTag),
    ustBasis: plan.ustBasis,
    eustAndereMonat: plan.eustAndereMonat,
    ustIstSchnitt: plan.ustIstSchnitt,
    paypal: pp ? { saldo: pp.saldo, stand: pp.stand, abgerufenAm: pp.abgerufenAm, eingerechnet: ppEin } : null,
    startSaldoGesamt: r2(startSaldo),
    nachbestellKgMonat: plan.nachbestellKgMonat,
    tage: sim.tage,
    ereignisse: plan.ereignisse,
    bestellungen,
    einfuhrAndere,
    ebruNachbestellKgMonat: plan.ebruNachbestellKgMonat,
    tiefpunkt: sim.tiefpunkt,
    tiefpunktMitAnderen: simAndere.tiefpunkt,
    hinweise: plan.hinweise,
  };
}
