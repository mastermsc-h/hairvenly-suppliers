/**
 * Kategorisierung von Kontoumsätzen + Erkennung von Finanzamt-Buchungen.
 *
 * REINE FUNKTIONEN ohne Abhängigkeiten — getestet in
 * scripts/smoke/bank-kategorien.spec.mjs.
 *
 * Reihenfolge der Entscheidung (erste greift):
 *   1. manuell gesetzte Kategorie (wird hier gar nicht erst neu berechnet)
 *   2. Finanzamt-Buchung mit lesbarem Verwendungszweck → Steuerart + Zeitraum
 *   3. Regeln (DB-Tabelle bank_kategorie_regeln), niedrigste Priorität zuerst
 *   4. Fallback: Kunden-Überweisung laut Vorkasse-Abgleich → Vorkasse
 *   5. "unklar"
 */

export type KategorieGruppe = "einnahmen" | "steuern" | "ausgaben" | "neutral";

export interface KategorieDef {
  key: string;
  label: string;
  gruppe: KategorieGruppe;
}

export const KATEGORIEN: KategorieDef[] = [
  // Einnahmen
  { key: "ein_shop", label: "Shop-Auszahlungen (Stripe, PayPal)", gruppe: "einnahmen" },
  { key: "ein_karte", label: "Kartenzahlungen (Nexi)", gruppe: "einnahmen" },
  { key: "ein_treatwell", label: "Treatwell-Auszahlungen", gruppe: "einnahmen" },
  { key: "ein_vorkasse", label: "Kundenüberweisungen (Vorkasse/Rechnung)", gruppe: "einnahmen" },
  { key: "ein_bargeld", label: "Bareinzahlungen", gruppe: "einnahmen" },
  { key: "ein_sonstige", label: "Sonstige Einnahmen", gruppe: "einnahmen" },
  // Steuern (Zahlungen und Erstattungen, vorzeichenrichtig)
  { key: "st_ust", label: "Umsatzsteuer", gruppe: "steuern" },
  { key: "st_eust", label: "Einfuhrumsatzsteuer / Zoll", gruppe: "steuern" },
  { key: "st_lohnsteuer", label: "Lohnsteuer", gruppe: "steuern" },
  { key: "st_est", label: "Einkommensteuer", gruppe: "steuern" },
  { key: "st_gewst", label: "Gewerbesteuer", gruppe: "steuern" },
  { key: "st_sonstige", label: "Sonstige Steuern / Zuschläge", gruppe: "steuern" },
  // Ausgaben
  { key: "aus_wareneinkauf", label: "Wareneinkauf Haare (Lieferanten)", gruppe: "ausgaben" },
  { key: "aus_material", label: "Material / Friseurbedarf", gruppe: "ausgaben" },
  { key: "aus_versand", label: "Versand (DHL Paket / Post)", gruppe: "ausgaben" },
  { key: "aus_personal", label: "Personal (Löhne)", gruppe: "ausgaben" },
  { key: "aus_sozialversicherung", label: "Sozialversicherung (Krankenkassen)", gruppe: "ausgaben" },
  { key: "aus_miete", label: "Miete", gruppe: "ausgaben" },
  { key: "aus_energie", label: "Strom / Energie", gruppe: "ausgaben" },
  { key: "aus_telefon", label: "Telefon / Internet", gruppe: "ausgaben" },
  { key: "aus_steuerberater", label: "Steuerberater", gruppe: "ausgaben" },
  { key: "aus_marketing", label: "Marketing / Werbung", gruppe: "ausgaben" },
  { key: "aus_software", label: "Software / Shopify / Hosting", gruppe: "ausgaben" },
  { key: "aus_versicherung", label: "Versicherungen", gruppe: "ausgaben" },
  { key: "aus_bank", label: "Bank- & Zahlungsgebühren", gruppe: "ausgaben" },
  { key: "aus_kredit", label: "Kredit-Tilgung (Shopify Capital)", gruppe: "ausgaben" },
  { key: "aus_buero", label: "Büro / Bewirtung / Bedarf", gruppe: "ausgaben" },
  { key: "aus_beitraege", label: "Beiträge / Gebühren", gruppe: "ausgaben" },
  { key: "aus_rueckerstattung", label: "Rückerstattungen an Kunden", gruppe: "ausgaben" },
  { key: "aus_karte", label: "Debitkarte (Händler nicht erkennbar)", gruppe: "ausgaben" },
  { key: "aus_sonstige", label: "Sonstige Ausgaben", gruppe: "ausgaben" },
  // Neutral (kein Aufwand/Ertrag)
  { key: "umbuchung", label: "Umbuchung eigene Konten", gruppe: "neutral" },
  // Darlehen sind keine Einnahme (Shopify Capital zahlte 200k/280k über "Banking Circle" aus)
  { key: "kredit_auszahlung", label: "Kredit-Auszahlung (Darlehen)", gruppe: "neutral" },
  // Gehälter, Miete, Lagermiete, Krankenkassen und Versicherungen laufen über das
  // Targobank-Gehaltskonto — der Übertrag dorthin ist selbst kein Aufwand.
  { key: "umbuchung_gehalt", label: "Übertrag Gehaltskonto (Targobank)", gruppe: "neutral" },
  { key: "privat", label: "Privatentnahme / -einlage", gruppe: "neutral" },
  { key: "info", label: "Hinweise ohne Betrag", gruppe: "neutral" },
  { key: "unklar", label: "Noch nicht zugeordnet", gruppe: "neutral" },
];

export const KATEGORIE_BY_KEY: Record<string, KategorieDef> = Object.fromEntries(KATEGORIEN.map((k) => [k.key, k]));

// ── Finanzamt-Verwendungszweck ──────────────────────────────────────────────

/** Ein Steuer-Anteil einer Buchung. betrag: + = an das Finanzamt gezahlt, − = erstattet. */
export interface SteuerSplit {
  art: "ust_va" | "ust_nachzahlung" | "eust" | "lst_anmeldung" | "est_vz" | "est_nachzahlung" | "gewst_vz" | "gewst_nachzahlung";
  zeitraum: string; // '2026-07' | 'Q3 2026' | '2025'
  jahr: number;
  betrag: number;
}

const MONATE: Record<string, number> = {
  JAN: 1, FEB: 2, MRZ: 3, MAR: 3, "MÄR": 3, MAE: 3, "MA.R": 3, APR: 4, MAI: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OKT: 10, NOV: 11, DEZ: 12,
};

type Periode = { kind: "monat" | "quartal" | "jahr"; zeitraum: string; jahr: number };

function parsePeriode(token: string): Periode | null {
  const t = token.toUpperCase();
  let m = t.match(/^(\d)VJ\.?(\d{2})$/);
  if (m) {
    const q = Number(m[1]);
    const jahr = 2000 + Number(m[2]);
    return q >= 1 && q <= 4 ? { kind: "quartal", zeitraum: `Q${q} ${jahr}`, jahr } : null;
  }
  m = t.match(/^(JAN|FEB|MRZ|MAR|MÄR|MAE|MA\.R|APR|MAI|JUN|JUL|AUG|SEP|OKT|NOV|DEZ)\.?(\d{2})$/);
  if (m) {
    const jahr = 2000 + Number(m[2]);
    return { kind: "monat", zeitraum: `${jahr}-${String(MONATE[m[1]]).padStart(2, "0")}`, jahr };
  }
  m = t.match(/^(20\d{2})$/);
  if (m) return { kind: "jahr", zeitraum: m[1], jahr: Number(m[1]) };
  return null;
}

function parseDeBetrag(s: string): number {
  return Number(s.replace(/\./g, "").replace(",", "."));
}

const STEUER_TOKEN =
  /(UMS\.?\s?ST|LOHNST|EINK\.?\s?ST|GEW\.?\s?ST|SOLZ|SOLI|KI\.?\s?ST|KIST)\.?\s+(\dVJ\.?\d{2}|(?:JAN|FEB|MRZ|MAR|MÄR|MAE|MA\.R|APR|MAI|JUN|JUL|AUG|SEP|OKT|NOV|DEZ)[.\s]?\d{2}(?!\d)|20\d{2})(?:\s+[A-ZÄÖÜ.]+Z\b)?(?:\s+(\d{1,3}(?:\.\d{3})*,\d{2})\s*EUR)?/gi;

function artFor(steuer: string, p: Periode): SteuerSplit["art"] {
  const s = steuer.toUpperCase().replace(/[\s.]/g, "");
  if (s === "UMSST") return p.kind === "jahr" ? "ust_nachzahlung" : "ust_va";
  if (s === "LOHNST") return "lst_anmeldung";
  if (s === "GEWST") return p.kind === "jahr" ? "gewst_nachzahlung" : "gewst_vz";
  // EINK.ST, SOLZ/SOLI, KI.ST laufen gemeinsam als Einkommensteuer (Vorauszahlung inkl. Soli/KiSt)
  return p.kind === "jahr" ? "est_nachzahlung" : "est_vz";
}

/**
 * Liest Steuerart, Zeitraum und Betrag aus einem Finanzamt-Verwendungszweck,
 * z.B. "STEUERNR 060/212/27747 LOHNST JUL.26 4.049,86EUR" oder
 * "ERSTATT.6021227747 UMS.ST JUN.26 18.114,12 EUR".
 * amount = Buchungsbetrag (− Zahlung, + Erstattung). Mehrere Steuern in einer
 * Buchung werden anhand der Einzelbeträge aufgeteilt; passt die Summe nicht,
 * wird nicht geraten (leeres Ergebnis → Kategorie "sonstige Steuern").
 */
export function parseSteuerZweck(purpose: string | null, amount: number): SteuerSplit[] {
  if (!purpose) return [];
  const sign = amount < 0 ? 1 : -1; // Ausgang = Zahlung ans FA (+), Eingang = Erstattung (−)
  const found: Array<{ art: SteuerSplit["art"]; p: Periode; betrag: number | null }> = [];
  for (const m of purpose.matchAll(STEUER_TOKEN)) {
    const p = parsePeriode(m[2].replace(/\s/g, ""));
    if (!p) continue;
    found.push({ art: artFor(m[1], p), p, betrag: m[3] ? parseDeBetrag(m[3]) : null });
  }
  if (found.length === 0) return [];

  const total = Math.abs(amount);
  if (found.length === 1) {
    const f = found[0];
    return [{ art: f.art, zeitraum: f.p.zeitraum, jahr: f.p.jahr, betrag: round2(sign * total) }];
  }
  // Mehrere Anteile: nur übernehmen, wenn alle Einzelbeträge da sind und aufgehen
  if (found.some((f) => f.betrag === null)) return [];
  const sum = found.reduce((s, f) => s + (f.betrag ?? 0), 0);
  if (Math.abs(sum - total) > 0.01) return [];
  // Gleiche Art+Zeitraum (z.B. EINK.ST + SOLZ) zusammenfassen
  const merged = new Map<string, SteuerSplit>();
  for (const f of found) {
    const key = `${f.art}|${f.p.zeitraum}`;
    const prev = merged.get(key);
    const betrag = round2(sign * (f.betrag ?? 0));
    if (prev) prev.betrag = round2(prev.betrag + betrag);
    else merged.set(key, { art: f.art, zeitraum: f.p.zeitraum, jahr: f.p.jahr, betrag });
  }
  return [...merged.values()];
}

/**
 * Inhaltlicher Vergleich zweier Split-Listen. Postgres-jsonb sortiert Objekt-Schlüssel
 * um — ein Vergleich per JSON.stringify hielte identische Daten für verschieden.
 */
export function gleicheSplits(a: SteuerSplit[] | null | undefined, b: SteuerSplit[] | null | undefined): boolean {
  const norm = (x: SteuerSplit[] | null | undefined) =>
    (x ?? []).map((s) => `${s.art}|${s.zeitraum}|${s.jahr}|${Math.round(Number(s.betrag) * 100)}`).join(";");
  return norm(a) === norm(b);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const ART_ZU_KATEGORIE: Record<SteuerSplit["art"], string> = {
  ust_va: "st_ust",
  ust_nachzahlung: "st_ust",
  eust: "st_eust",
  lst_anmeldung: "st_lohnsteuer",
  est_vz: "st_est",
  est_nachzahlung: "st_est",
  gewst_vz: "st_gewst",
  gewst_nachzahlung: "st_gewst",
};

/** Gegenpartei ist die Finanzkasse (Bremen: Landeshauptkasse, auch für die GewSt). */
export function istFinanzamt(tx: { counterparty_name: string | null; counterparty_iban: string | null; purpose: string | null }): boolean {
  const name = (tx.counterparty_name ?? "").toLowerCase().replace(/\s+/g, "");
  if (name.includes("finanzkasse") || name.includes("landeshauptkasse") || name.includes("finanzamt")) return true;
  if ((tx.counterparty_iban ?? "").replace(/\s/g, "").toUpperCase() === "DE59250000000025001532") return true;
  return /\bSTEUERNR\b/i.test(tx.purpose ?? "");
}

// ── Gegenpartei aus dem Verwendungszweck (Targobank) ────────────────────────

/**
 * Die Targobank liefert Gegenpartei und IBAN NICHT in eigenen Feldern, sondern nur im
 * Verwendungszweck: "ECHTZEITÜBERWEISUNG INLAND  TBOL MEHMET CAKMAK AUGUST GEHALT   IBAN
 * DE93290501010015124738 BIC SBREDE22XXX AM 02.09.2026". Fehlt counterparty_iban, wird die
 * IBAN von dort gelesen (eigene Konten, Regeln, Vorkasse-Abgleich).
 */
export function ibanAusZweck(purpose: string | null): string | null {
  const text = purpose ?? "";
  const m = text.match(/\bIBAN:?\s?([A-Z]{2}\d{2}[A-Z0-9]{10,30})\b/);
  if (m) return m[1];
  // Ohne das Wort "IBAN": "UEBERTRAG AUF GESCHAEFTSKONTO DE56290501010084626001" — nur deutsche
  // IBAN (fest 22 Zeichen), damit Referenz- oder Rechnungsnummern nicht als IBAN gelten
  const de = text.match(/\b(DE\d{20})\b/);
  return de ? de[1] : null;
}

export function effektiveIban(tx: { counterparty_iban?: string | null; purpose: string | null }): string | null {
  return tx.counterparty_iban || ibanAusZweck(tx.purpose);
}

// ── Regeln ──────────────────────────────────────────────────────────────────

export interface KategorieRegel {
  id: string;
  prioritaet: number;
  feld: "counterparty_name" | "counterparty_iban" | "purpose" | "posting_text";
  muster: string; // Groß-/Kleinschreibung egal, Teilstring
  richtung: "ein" | "aus" | "alle";
  kategorie: string;
}

export interface KategorieTx {
  amount: number;
  booking_date: string;
  counterparty_name: string | null;
  counterparty_iban: string | null;
  purpose: string | null;
  posting_text: string | null;
  match_status: string;
}

export interface KategorieErgebnis {
  kategorie: string;
  quelle: "regel" | "auto";
  regel_id: string | null;
  steuer_split: SteuerSplit[];
}

const RUECKZAHLUNG = /r(?:ü|ue|u)ck(?:zahlung|überweisung|ueberweisung|erstattung)|zurückzahlung|zurueckzahlung|gehalt/i;

function normFeld(s: string | null): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ");
}

/** Regeln stabil sortieren: Priorität aufsteigend, bei Gleichstand das längere (spezifischere) Muster zuerst. */
export function sortRegeln(regeln: KategorieRegel[]): KategorieRegel[] {
  return [...regeln].sort((a, b) => a.prioritaet - b.prioritaet || b.muster.length - a.muster.length || a.id.localeCompare(b.id));
}

export function kategorisiere(tx: KategorieTx, regelnSortiert: KategorieRegel[]): KategorieErgebnis {
  // 1) Finanzamt mit lesbarem Zweck
  if (istFinanzamt(tx)) {
    const split = parseSteuerZweck(tx.purpose, tx.amount);
    if (split.length > 0) {
      const groesster = split.reduce((a, b) => (Math.abs(b.betrag) > Math.abs(a.betrag) ? b : a));
      const kategorie = ART_ZU_KATEGORIE[groesster.art];
      return { kategorie, quelle: "auto", regel_id: null, steuer_split: split };
    }
    // Finanzamt, aber Zweck nicht lesbar (Säumniszuschlag, Kassenzeichen …) — keine allgemeinen
    // Regeln anwenden: "LOHNST MAI 26" landete sonst per "lohn"-Regel bei Personal (gefunden 19.10.2026)
    return { kategorie: "st_sonstige", quelle: "auto", regel_id: null, steuer_split: [] };
  }

  // 2) Regeln
  const richtung = tx.amount >= 0 ? "ein" : "aus";
  for (const r of regelnSortiert) {
    if (r.richtung !== "alle" && r.richtung !== richtung) continue;
    const muster = normFeld(r.muster);
    if (!muster) continue;
    // Ohne eigenes Namens-/IBAN-Feld (Targobank) steht beides im Verwendungszweck
    const wert =
      r.feld === "counterparty_iban"
        ? (effektiveIban(tx) ?? "").replace(/\s/g, "").toLowerCase()
        : r.feld === "counterparty_name" && !tx.counterparty_name
          ? normFeld(tx.purpose)
          : normFeld(tx[r.feld]);
    if (!wert.includes(r.feld === "counterparty_iban" ? muster.replace(/\s/g, "") : muster)) continue;
    return { kategorie: r.kategorie, quelle: "regel", regel_id: r.id, steuer_split: steuerSplitFuer(r.kategorie, tx) };
  }

  // 4) Bank-Hinweise ohne Betrag (Kartensperre, Dauerauftrag eröffnet, Zinssätze …)
  if (tx.amount === 0) return { kategorie: "info", quelle: "auto", regel_id: null, steuer_split: [] };

  // 5) Übrige Eingänge = Kundenüberweisungen (Vorkasse/Rechnung). Auch die vor dem Start
  //    des Vorkasse-Abgleichs (match_status "ignored") — sonst stünden 90 Tage Altlasten
  //    als "unklar" da. Ausnahme: Rückzahlungen/Rücküberweisungen → Mensch entscheidet.
  if (tx.amount > 0) {
    if (RUECKZAHLUNG.test(tx.purpose ?? "")) return { kategorie: "unklar", quelle: "auto", regel_id: null, steuer_split: [] };
    return { kategorie: "ein_vorkasse", quelle: "auto", regel_id: null, steuer_split: [] };
  }

  return { kategorie: "unklar", quelle: "auto", regel_id: null, steuer_split: [] };
}

/**
 * Steuer-Zuordnung für Kategorien ohne Finanzamt-Zweck. Nur EUSt/Zoll bekommt
 * einen Zeitraum (Buchungsmonat) — EUSt ist eine Monatssteuer und wird dem
 * Monat zugeordnet, in dem sie bezahlt wurde.
 */
export function steuerSplitFuer(kategorie: string, tx: Pick<KategorieTx, "amount" | "booking_date" | "purpose" | "counterparty_name" | "counterparty_iban">): SteuerSplit[] {
  if (kategorie === "st_eust") {
    const zeitraum = tx.booking_date.slice(0, 7);
    return [{ art: "eust", zeitraum, jahr: Number(zeitraum.slice(0, 4)), betrag: round2(-tx.amount) }];
  }
  if (kategorie.startsWith("st_") && istFinanzamt(tx)) return parseSteuerZweck(tx.purpose, tx.amount);
  return [];
}

// ── Fälligkeiten ────────────────────────────────────────────────────────────

/**
 * Hairvenly hat eine Dauerfristverlängerung (User-Bestätigung 16.10.2026):
 * USt-VA ist erst am 10. des ÜBERNÄCHSTEN Monats fällig. Gilt nur für die USt,
 * nicht für die Lohnsteuer-Anmeldung.
 */
export const DAUERFRISTVERLAENGERUNG = true;

function werktag(jahr: number, monat1: number, tag: number): string {
  // monat1 darf > 12 sein (Überlauf ins Folgejahr)
  const d = new Date(Date.UTC(jahr, monat1 - 1, tag));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Gesetzliche Fälligkeit (Wochenende → Montag; Feiertage nicht berücksichtigt). null = unbekannt. */
export function faelligkeit(art: SteuerSplit["art"], zeitraum: string): string | null {
  const m = zeitraum.match(/^(\d{4})-(\d{2})$/);
  const q = zeitraum.match(/^Q([1-4]) (\d{4})$/);
  if (m) {
    const jahr = Number(m[1]);
    const monat = Number(m[2]);
    if (art === "ust_va" || art === "eust") return werktag(jahr, monat + (art === "ust_va" && DAUERFRISTVERLAENGERUNG ? 2 : 1), 10);
    if (art === "lst_anmeldung") return werktag(jahr, monat + 1, 10);
    return null;
  }
  if (q) {
    const quartal = Number(q[1]);
    const jahr = Number(q[2]);
    if (art === "est_vz") return werktag(jahr, quartal * 3, 10); // 10.03./06./09./12.
    if (art === "gewst_vz") return werktag(jahr, quartal * 3 - 1, 15); // 15.02./05./08./11.
  }
  return null;
}

// ── Abgleich Bank → Steuer-Ledger ───────────────────────────────────────────

export interface SteuerBankSumme {
  art: SteuerSplit["art"];
  zeitraum: string;
  jahr: number;
  netto: number; // + gezahlt, − erstattet
  anzahl: number;
  letzte_buchung: string;
}

/** Summiert alle Steuer-Anteile je Art+Zeitraum (vorzeichenrichtig). */
export function summiereSteuern(txs: Array<{ booking_date: string; steuer_split: SteuerSplit[] | null }>): SteuerBankSumme[] {
  const map = new Map<string, SteuerBankSumme>();
  for (const tx of txs) {
    for (const s of tx.steuer_split ?? []) {
      const key = `${s.art}|${s.zeitraum}`;
      const prev = map.get(key);
      if (prev) {
        prev.netto = round2(prev.netto + s.betrag);
        prev.anzahl += 1;
        if (tx.booking_date > prev.letzte_buchung) prev.letzte_buchung = tx.booking_date;
      } else {
        map.set(key, { art: s.art, zeitraum: s.zeitraum, jahr: s.jahr, netto: round2(s.betrag), anzahl: 1, letzte_buchung: tx.booking_date });
      }
    }
  }
  return [...map.values()];
}

export interface LedgerPostenStand {
  ist_betrag: number;
  soll_betrag: number;
  richtung: "zahlung" | "erstattung";
  ist_quelle: "manuell" | "bank";
}

/**
 * Was die Bank am Ledger-Posten ändern darf. Invariante: ein von Hand
 * eingetragenes Ist wird NIE überschrieben — dann wird nur bank_betrag
 * gesetzt und die Abweichung angezeigt.
 */
export function ledgerUpdate(
  posten: LedgerPostenStand,
  summe: SteuerBankSumme
): { ist_betrag?: number; richtung?: "zahlung" | "erstattung"; bezahlt_am?: string | null; ist_quelle?: "bank" } {
  const manuell = posten.ist_quelle === "manuell" && Number(posten.ist_betrag) !== 0;
  if (manuell) return {};
  if (summe.netto === 0) {
    // Zahlung und Erstattung heben sich auf — Ist nur zurücksetzen, wenn es von der Bank kam
    return posten.ist_quelle === "bank" ? { ist_betrag: 0, bezahlt_am: null, ist_quelle: "bank" } : {};
  }
  const richtung = summe.netto > 0 ? "zahlung" : "erstattung";
  // Soll in die Gegenrichtung eingetragen (z.B. Zahlung erwartet, Bank zeigt Erstattung):
  // Widerspruch → nichts überschreiben, nur bank_betrag anzeigen lassen.
  if (richtung !== posten.richtung && Number(posten.soll_betrag) !== 0) return {};
  const patch: ReturnType<typeof ledgerUpdate> = {
    ist_betrag: Math.abs(summe.netto),
    bezahlt_am: summe.letzte_buchung,
    ist_quelle: "bank",
  };
  if (richtung !== posten.richtung) patch.richtung = richtung;
  return patch;
}
