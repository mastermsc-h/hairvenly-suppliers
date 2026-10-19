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
  };
  nachbestellung: {
    /** Ø bestellte kg/Monat (letzte 3 Monate) — war zuletzt Black-Friday-Vorrat, nicht Verbrauch. */
    kgProMonatAuto: number;
    /** Verkauf Russisch glatt laut Verkaufsanalyse (Ø 3 Monate); null = Sheet nicht erreichbar. */
    kgVerbrauchMonat: number | null;
    usdProKgAuto: number;
    leadWochen: number;
  };
}

// ── Ereignisse + Prognose ───────────────────────────────────────────────────

export type EreignisArt = "lieferant" | "einfuhr" | "steuer" | "nachbestellung" | "aktion";

export interface Ereignis {
  datum: string;
  betrag: number; // + Eingang, − Ausgang
  art: EreignisArt;
  label: string;
  orderId?: string;
  sofort?: boolean; // eigentlich schon fällig
}

export type Ampel = "ok" | "knapp" | "luecke";

export interface BestellPrognose {
  orderId: string;
  label: string;
  status: string;
  eta: string | null;
  zahlDatum: string;
  sofort: boolean;
  /** Restbetrag 0 → an den Lieferanten nichts mehr zu zahlen (nur noch Einfuhrabgaben). */
  bezahlt: boolean;
  betragUsd: number;
  betragEur: number;
  saldoNachZahlung: number;
  ampel: Ampel;
  fehlbetrag: number; // > 0 bei Lücke/unter Puffer
  einfuhr: { datum: string; eust: number; zoll: number; saldoDanach: number; ampel: Ampel } | null;
}

export interface PrognoseErgebnis {
  start: string;
  fx: number;
  fxQuelle: "auto" | "manuell" | "standard";
  einnahmenProTag: number;
  laufendProTag: number; // negativ
  andereLieferantenProTag: number; // negativ (nur wenn eingerechnet)
  ustBasis: number;
  /** Ø EUSt pro Monat aus Importen anderer Lieferanten (Ebru …), aus der Historie. */
  eustAndereMonat: number;
  /** Ø tatsächliche USt-Zahllast (nach Vorsteuer und EUSt) der Historienmonate. */
  ustIstSchnitt: number | null;
  /** Für die Nachbestell-Schätzung verwendete kg/Monat. */
  nachbestellKgMonat: number;
  tage: Array<{ datum: string; saldo: number }>;
  ereignisse: Ereignis[];
  bestellungen: BestellPrognose[];
  tiefpunkt: { datum: string; saldo: number };
  /** Tiefpunkt, wenn andere Lieferanten (Ø) zusätzlich eingerechnet würden — als Warnung. */
  tiefpunktMitAnderen: { datum: string; saldo: number };
  hinweise: string[];
}

const SOFORT_STATUS = ["ready_to_ship", "shipped", "in_customs"];
const r2 = (n: number) => Math.round(n * 100) / 100;

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
  bestellInfo: Map<string, { zahlDatum: string; sofort: boolean; usd: number; eur: number; einfuhr: { datum: string; eust: number; zoll: number } | null }>;
  hinweise: string[];
  nachbestellKgMonat: number;
  eustAndereMonat: number;
  ustIstSchnitt: number | null;
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

  // 1) Amanda-Bestellungen: Zahlung bei "versandbereit" (≈ Ankunft − X Tage), Einfuhrabgaben bei Ankunft
  for (const b of roh.bestellungen) {
    const bezahlt = b.restUsd <= 0.01;
    const sofort = !bezahlt && (SOFORT_STATUS.includes(b.status) || (!!b.eta && plusTage(b.eta, -e.zahlungVorAnkunftTage) < start));
    const zahlDatum = SOFORT_STATUS.includes(b.status) || !b.eta ? start : amStart(plusTage(b.eta, -e.zahlungVorAnkunftTage));
    if (!b.eta && !bezahlt) hinweise.push(`${b.label}: kein Ankunftsdatum — Zahlung sofort angenommen.`);
    const eur = r2(b.restUsd / fx);
    if (!bezahlt) {
      ereignisse.push({ datum: zahlDatum, betrag: -eur, art: "lieferant", label: b.label, orderId: b.id, sofort });
    }
    let einfuhr: { datum: string; eust: number; zoll: number } | null = null;
    if (b.status !== "delivered" && (b.invoiceUsd ?? 0) > 0) {
      const ab = einfuhrFuer(b.invoiceUsd ?? 0, b.importVatEur);
      const datum = amStart(b.eta ?? start);
      einfuhr = { datum, ...ab };
      ereignisse.push({ datum, betrag: -(ab.eust + ab.zoll), art: "einfuhr", label: `Einfuhrabgaben ${b.label}`, orderId: b.id });
      eustProMonat[monatVon(datum)] = (eustProMonat[monatVon(datum)] ?? 0) + ab.eust;
    }
    bestellInfo.set(b.id, { zahlDatum, sofort, usd: b.restUsd, eur, einfuhr });
  }

  // 2) Künftige Nachbestellungen (Schätzung): wöchentlich ab nächstem Montag
  const nachbestellKgMonat = e.nachbestellKgMonat ?? roh.nachbestellung.kgVerbrauchMonat ?? roh.nachbestellung.kgProMonatAuto;
  if (e.nachbestellungenEinrechnen) {
    const kgMonat = nachbestellKgMonat;
    const usdKg = e.usdProKg ?? roh.nachbestellung.usdProKgAuto;
    const leadTage = roh.nachbestellung.leadWochen * 7;
    const kgWoche = (kgMonat * 12) / 52;
    let d = start;
    while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 1) d = plusTage(d, 1);
    for (; d <= ende; d = plusTage(d, 7)) {
      const usd = kgWoche * usdKg;
      const zahl = plusTage(d, leadTage - e.zahlungVorAnkunftTage);
      const ankunft = plusTage(d, leadTage);
      if (zahl <= ende) ereignisse.push({ datum: zahl, betrag: -r2(usd / fx), art: "nachbestellung", label: `Nachbestellung ~${kgWoche.toFixed(1)} kg (bestellt ${d})` });
      if (ankunft <= ende) {
        const ab = einfuhrFuer(usd, null);
        ereignisse.push({ datum: ankunft, betrag: -(ab.eust + ab.zoll), art: "einfuhr", label: `Einfuhrabgaben Nachbestellung ${d}` });
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
      const eustAndere = m >= aktMonat ? eustAndereMonat : 0;
      const betrag = r2(ustBasis + (ustZusatz[m] ?? 0) - (eustProMonat[m] ?? 0) - eustAndere);
      const datum = betrag < 0 ? plusTage(faellig, 21) : faellig;
      if (datum > ende) continue;
      ereignisse.push({
        datum: amStart(datum),
        betrag: -betrag,
        art: "steuer",
        label: betrag < 0 ? `USt-Erstattung ${m} (EUSt-Verrechnung)` : `USt-VA ${m}`,
        sofort: datum < start,
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
      ereignisse.push({ datum: amStart(faellig), betrag: -lst, art: "steuer", label: `Lohnsteuer ${m}`, sofort: faellig < start });
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
        if (!betrag || !faellig || faellig < start || faellig > ende) continue;
        if (roh.steuern.quartaleErledigt.includes(`${art}|${zeitraum}`)) continue;
        ereignisse.push({ datum: faellig, betrag: -betrag, art: "steuer", label: `${name} ${zeitraum}` });
      }
    }
  }

  // Innerhalb eines Tages: Eingänge vor Ausgängen, sonst stabil
  ereignisse.sort((a, b) => a.datum.localeCompare(b.datum) || Math.sign(b.betrag) - Math.sign(a.betrag));
  return { start, ende, fx, fxQuelle, ereignisse, ustBasis, eustAndereMonat, ustIstSchnitt, bestellInfo, hinweise, nachbestellKgMonat };
}

function simuliere(
  startSaldo: number,
  start: string,
  ende: string,
  proTag: number,
  ereignisse: Ereignis[]
): { tage: Array<{ datum: string; saldo: number }>; nachEreignis: Map<Ereignis, number>; tiefpunkt: { datum: string; saldo: number } } {
  const tage: Array<{ datum: string; saldo: number }> = [];
  const nachEreignis = new Map<Ereignis, number>();
  let saldo = startSaldo;
  let tief = { datum: start, saldo: startSaldo };
  let i = 0;
  for (let d = start; d <= ende; d = plusTage(d, 1)) {
    saldo += proTag;
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

  const sim = simuliere(roh.startSaldo, plan.start, plan.ende, proTag, plan.ereignisse);
  const simAndere = e.andereLieferantenEinrechnen
    ? sim
    : simuliere(roh.startSaldo, plan.start, plan.ende, proTag + andereGesamtProTag, plan.ereignisse);

  const bestellungen: BestellPrognose[] = [];
  for (const b of roh.bestellungen) {
    const info = plan.bestellInfo.get(b.id);
    if (!info) continue;
    const zahlEv = plan.ereignisse.find((x) => x.orderId === b.id && x.art === "lieferant");
    const einfEv = plan.ereignisse.find((x) => x.orderId === b.id && x.art === "einfuhr");
    const saldoNach = zahlEv ? sim.nachEreignis.get(zahlEv) ?? roh.startSaldo : roh.startSaldo;
    const ampel = zahlEv ? ampelFuer(saldoNach, e.puffer) : "ok";
    const einfSaldo = einfEv ? sim.nachEreignis.get(einfEv) ?? saldoNach : null;
    bestellungen.push({
      orderId: b.id,
      label: b.label,
      status: b.status,
      eta: b.eta,
      zahlDatum: info.zahlDatum,
      sofort: info.sofort,
      bezahlt: info.usd <= 0.01,
      betragUsd: info.usd,
      betragEur: info.eur,
      saldoNachZahlung: r2(saldoNach),
      ampel,
      fehlbetrag: r2(Math.max(0, (ampel === "luecke" ? 0 : e.puffer) - saldoNach)),
      einfuhr: info.einfuhr && einfSaldo !== null
        ? { ...info.einfuhr, saldoDanach: r2(einfSaldo), ampel: ampelFuer(einfSaldo, e.puffer) }
        : null,
    });
  }

  return {
    start: plan.start,
    fx: plan.fx,
    fxQuelle: plan.fxQuelle,
    einnahmenProTag,
    laufendProTag,
    andereLieferantenProTag: r2(andereGesamtProTag),
    ustBasis: plan.ustBasis,
    eustAndereMonat: plan.eustAndereMonat,
    ustIstSchnitt: plan.ustIstSchnitt,
    nachbestellKgMonat: plan.nachbestellKgMonat,
    tage: sim.tage,
    ereignisse: plan.ereignisse,
    bestellungen,
    tiefpunkt: sim.tiefpunkt,
    tiefpunktMitAnderen: simAndere.tiefpunkt,
    hinweise: plan.hinweise,
  };
}
