// Rechnungen für /finances/steuertipps (rein, ohne React).
// Grundlage ist dieselbe ESt/GewSt-Kette wie in der Finanzübersicht (taxChain) — damit zeigt die
// Tipps-Seite exakt die Ersparnis, die auch die Steuerkasse/Prognose sehen würde.
import { calcESt, calcSoli, taxChain } from "./steuerrechnung";

export const r0 = (n: number) => Math.round(n);

/** Steuer (ESt inkl. Soli + GewSt) eines Einzelunternehmers vor/nach einem zusätzlichen Abzug. */
export function ersparnis(gewinn: number, abzug: number, hebesatz: number, freibetrag: number, jahr: number) {
  const vorher = taxChain(gewinn, hebesatz, freibetrag, jahr);
  const nachher = taxChain(gewinn - abzug, hebesatz, freibetrag, jahr);
  return {
    vorher: { est: vorher.estGesamt, gewst: vorher.gewstJahr, gesamt: vorher.steuerGesamt },
    nachher: { est: nachher.estGesamt, gewst: nachher.gewstJahr, gesamt: nachher.steuerGesamt },
    gespart: vorher.steuerGesamt - nachher.steuerGesamt,
    gespartEst: vorher.estGesamt - nachher.estGesamt,
    gespartGewst: vorher.gewstJahr - nachher.gewstJahr,
  };
}

/** Grenzsteuersatz: wie viel Steuer spart der nächste abgesetzte Euro (über 1.000 € gemittelt). */
export function grenzsatz(gewinn: number, hebesatz: number, freibetrag: number, jahr: number) {
  return ersparnis(gewinn, 1000, hebesatz, freibetrag, jahr).gespart / 1000;
}

// ── Sozialversicherung 2026 (Arbeitgeber-/Arbeitnehmer-Anteile, Beitragsbemessungsgrenzen) ──────
// BBG 2026 (bundeseinheitlich): RV/AV 8.450 €/Monat, KV/PV 5.812,50 €/Monat.
// Sätze: RV 18,6 %, AV 2,6 %, KV 14,6 % + Ø-Zusatzbeitrag 2,9 %, PV 3,6 % (AN kinderlos +0,6 %).
export const SV_2026 = {
  bbgRvMonat: 8_450,
  bbgKvMonat: 5_812.5,
  ag: { rvAv: 0.093 + 0.013, kvPv: 0.073 + 0.0145 + 0.018 },
  an: { rvAv: 0.093 + 0.013, kvPv: 0.073 + 0.0145 + 0.018 },
  umlagenAg: 0.016, // U1/U2/Insolvenzgeld grob (U1 je Kasse) — nur auf das Entgelt bis RV-BBG
};

/**
 * SV auf eine Einmalzahlung (sonstiger Bezug) im Monat `monat`: beitragspflichtig ist sie nur bis zur
 * anteiligen Jahres-BBG (BBG × Monate bis einschließlich Auszahlungsmonat) minus dem bisher
 * verbeitragten Lohn. Vereinfachung: gleichbleibendes Monatsgehalt seit Januar, keine frühere Einmalzahlung.
 */
export function svEinmalzahlung(bonus: number, monatsgehalt: number, monat: number, schonEinmal = 0) {
  const s = SV_2026;
  const bisher = monatsgehalt * monat + schonEinmal;
  const raumRv = Math.max(0, s.bbgRvMonat * monat - Math.min(bisher, s.bbgRvMonat * monat));
  const raumKv = Math.max(0, s.bbgKvMonat * monat - Math.min(bisher, s.bbgKvMonat * monat));
  const pflichtRv = Math.min(bonus, raumRv);
  const pflichtKv = Math.min(bonus, raumKv);
  const ag = pflichtRv * (s.ag.rvAv + s.umlagenAg) + pflichtKv * s.ag.kvPv;
  const an = pflichtRv * s.an.rvAv + pflichtKv * s.an.kvPv;
  return { ag, an, pflichtRv, pflichtKv };
}

/** Lohnsteuer (Steuerklasse I, ohne Kirche) auf einen sonstigen Bezug: Jahres-ESt mit minus ohne Bonus. */
export function lstEinmalzahlung(jahresBrutto: number, bonus: number, jahr: number) {
  // Grobe Jahres-Bemessung: Brutto − Werbungskostenpauschale − pauschale Vorsorge (~12 % vom Brutto bis RV-BBG)
  const zve = (b: number) => Math.max(0, b - 1_230 - Math.min(b, SV_2026.bbgRvMonat * 12) * 0.12);
  const ohne = calcESt(zve(jahresBrutto), jahr);
  const mit = calcESt(zve(jahresBrutto + bonus), jahr);
  const est = mit - ohne;
  const soli = calcSoli(mit, jahr) - calcSoli(ohne, jahr);
  return est + soli;
}

export type BonusErgebnis = {
  personen: number;
  bonusGesamt: number;
  agSv: number;
  aufwand: number; // was die Firma absetzt (Bonus + AG-SV)
  steuerGespart: number; // ESt + GewSt des Inhabers
  nettoKostenFirma: number; // Aufwand − Steuerersparnis
  nettoJePerson: number; // was beim Manager ankommt (je Person, gesamt über alle Zahlungen)
  abzuegeJePerson: { lst: number; sv: number };
};

/**
 * Manager-Bonus: `personen` × `betrag` je Zahlung, gezahlt in den `monate` (1–12).
 * Für den Inhaber ist alles (Bonus + AG-Anteil SV) Betriebsausgabe im Jahr der Zahlung.
 */
export function bonusRechnung(opts: {
  personen: number;
  betrag: number;
  monate: number[];
  monatsgehalt: number;
  gewinn: number;
  hebesatz: number;
  freibetrag: number;
  jahr: number;
}): BonusErgebnis {
  const { personen, betrag, monate, monatsgehalt, gewinn, hebesatz, freibetrag, jahr } = opts;
  let agSv = 0, anSv = 0, schon = 0;
  for (const m of [...monate].sort((a, b) => a - b)) {
    const sv = svEinmalzahlung(betrag, monatsgehalt, m, schon);
    agSv += sv.ag;
    anSv += sv.an;
    schon += betrag;
  }
  const bonusJe = betrag * monate.length;
  const lst = lstEinmalzahlung(monatsgehalt * 12, bonusJe, jahr);
  const aufwand = (bonusJe + agSv) * personen;
  const gespart = ersparnis(gewinn, aufwand, hebesatz, freibetrag, jahr).gespart;
  return {
    personen,
    bonusGesamt: bonusJe * personen,
    agSv: agSv * personen,
    aufwand,
    steuerGespart: gespart,
    nettoKostenFirma: aufwand - gespart,
    nettoJePerson: bonusJe - lst - anSv,
    abzuegeJePerson: { lst, sv: anSv },
  };
}

// ── Rechtsformvergleich ─────────────────────────────────────────────────────────────────────────

/** Körperschaftsteuer-Satz je Jahr (Senkung ab 2028 um 1 Punkt pro Jahr bis 10 % in 2032). */
export function kstSatz(jahr: number) {
  if (jahr <= 2027) return 0.15;
  return Math.max(0.1, 0.15 - (jahr - 2027) * 0.01);
}

export type RechtsformErgebnis = {
  key: "eu" | "gmbh" | "holding";
  titel: string;
  /** Steuern, die im Jahr sofort anfallen (Firma + privat auf Gehalt/Ausschüttung). */
  sofort: number;
  /** Teile für das Diagramm. */
  teile: { label: string; betrag: number }[];
  /** Bleibt nach Steuern übrig (privat + in der Firma/Holding). */
  netto: number;
  /** Davon privat verfügbar. */
  privat: number;
  /** Steuer, wenn später alles privat ausgeschüttet wird (inkl. sofort). */
  gesamtBeiVollausschuettung: number;
};

/**
 * Vergleich bei gleichem Gewinn vor Inhaber-Gehalt.
 * - Einzelunternehmen: taxChain (ESt+Soli+GewSt, § 35-Anrechnung).
 * - GmbH: Geschäftsführergehalt ist Betriebsausgabe (beherrschender Gesellschafter-GF: SV-frei),
 *   Rest KSt + Soli + GewSt (kein Freibetrag). Ausschüttung privat: Abgeltungsteuer 25 % + Soli.
 * - GmbH + Holding: Ausschüttung an die Holding zu 95 % steuerfrei (§ 8b KStG, GewSt-Schachtel) →
 *   ≈ 1,6 % Belastung; Geld bleibt in der Holding zum Reinvestieren.
 * Vereinfachungen: ledig, keine Kirchensteuer, keine Sonderausgaben, keine Pensionszusage.
 */
export function rechtsformVergleich(opts: {
  gewinn: number;
  gfGehalt: number;
  ausschuettungsQuote: number; // 0..1 vom Gewinn nach Steuern der GmbH, privat ausgeschüttet
  hebesatz: number;
  freibetrag: number;
  jahr: number;
}): RechtsformErgebnis[] {
  const { gewinn, gfGehalt, ausschuettungsQuote, hebesatz, freibetrag, jahr } = opts;

  // Einzelunternehmen
  const eu = taxChain(gewinn, hebesatz, freibetrag, jahr);
  const euErg: RechtsformErgebnis = {
    key: "eu",
    titel: "Einzelunternehmen (heute)",
    sofort: eu.steuerGesamt,
    teile: [
      { label: "Einkommensteuer + Soli", betrag: eu.estGesamt },
      { label: "Gewerbesteuer", betrag: eu.gewstJahr },
    ],
    netto: gewinn - eu.steuerGesamt,
    privat: gewinn - eu.steuerGesamt,
    gesamtBeiVollausschuettung: eu.steuerGesamt,
  };

  // GmbH
  const gehalt = Math.min(gfGehalt, Math.max(0, gewinn));
  const gewinnGmbH = Math.max(0, gewinn - gehalt);
  const kst = gewinnGmbH * kstSatz(jahr);
  const kstSoli = kst * 0.055;
  const gewst = Math.floor(gewinnGmbH / 100) * 100 * 0.035 * (hebesatz / 100);
  const nachSteuerGmbH = gewinnGmbH - kst - kstSoli - gewst;
  const zveGehalt = Math.max(0, gehalt - 1_230);
  const estGehalt = calcESt(zveGehalt, jahr);
  const soliGehalt = calcSoli(estGehalt, jahr);
  const ausschuettung = nachSteuerGmbH * ausschuettungsQuote;
  const abgelt = ausschuettung * 0.25 * 1.055;
  const firmaSteuer = kst + kstSoli + gewst;
  const gmbhErg: RechtsformErgebnis = {
    key: "gmbh",
    titel: "GmbH",
    sofort: firmaSteuer + estGehalt + soliGehalt + abgelt,
    teile: [
      { label: "ESt auf GF-Gehalt", betrag: estGehalt + soliGehalt },
      { label: "Körperschaftsteuer + Soli", betrag: kst + kstSoli },
      { label: "Gewerbesteuer", betrag: gewst },
      { label: "Abgeltungsteuer Ausschüttung", betrag: abgelt },
    ],
    netto: gewinn - (firmaSteuer + estGehalt + soliGehalt + abgelt),
    privat: gehalt - estGehalt - soliGehalt + ausschuettung - abgelt,
    gesamtBeiVollausschuettung: firmaSteuer + estGehalt + soliGehalt + nachSteuerGmbH * 0.25 * 1.055,
  };

  // GmbH + Holding: die Ausschüttungsquote geht privat, der Rest wandert in die Holding (≈ 1,6 % Steuer)
  const anHolding = nachSteuerGmbH - ausschuettung;
  const holdingSteuer = anHolding * 0.05 * (kstSatz(jahr) * 1.055 + 0.035 * (hebesatz / 100));
  const holdingErg: RechtsformErgebnis = {
    key: "holding",
    titel: "GmbH + Holding",
    sofort: firmaSteuer + estGehalt + soliGehalt + abgelt + holdingSteuer,
    teile: [
      { label: "ESt auf GF-Gehalt", betrag: estGehalt + soliGehalt },
      { label: "Körperschaftsteuer + Soli", betrag: kst + kstSoli },
      { label: "Gewerbesteuer", betrag: gewst },
      { label: "Abgeltungsteuer Ausschüttung", betrag: abgelt },
      { label: "Holding (5 % steuerpflichtig)", betrag: holdingSteuer },
    ],
    netto: gewinn - (firmaSteuer + estGehalt + soliGehalt + abgelt + holdingSteuer),
    privat: gehalt - estGehalt - soliGehalt + ausschuettung - abgelt,
    gesamtBeiVollausschuettung: firmaSteuer + estGehalt + soliGehalt + holdingSteuer + (anHolding - holdingSteuer + ausschuettung) * 0.25 * 1.055,
  };

  return [euErg, gmbhErg, holdingErg];
}
