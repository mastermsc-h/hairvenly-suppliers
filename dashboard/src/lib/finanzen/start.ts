import { createServiceClient } from "@/lib/supabase/server";
import { ladePrognose } from "@/lib/liquiditaet/daten";
import { ladeHy } from "@/lib/cockpit/daten";
import { ladeUstMonate, type UstMonat } from "@/lib/steuer/ust-monate";
import { KATEGORIE_BY_KEY } from "@/lib/bank/kategorien";
import { kontoZweck } from "@/lib/bank/konten";

export type Ampel = "gruen" | "gelb" | "rot" | "info";

export interface FinanzStart {
  stand: string;
  konten: { gesamt: number; liste: Array<{ name: string; saldo: number; stand: string }> };
  liquiditaet: { tiefpunkt: { datum: string; saldo: number }; puffer: number; ende: { datum: string; saldo: number } | null };
  umsatz: { monat: string; shop: number; salon: number; jahrShop: number; jahrSalon: number; vorjahrMonatShop: number | null };
  ust: { monate: UstMonat[]; abgerechnet: number; offen: number; offeneMonate: Array<{ monat: string; betrag: number; faellig: string }> };
  steuerTermine: Array<{ datum: string; label: string; betrag: number; geschaetzt: boolean }>;
  fixkosten: { summe: number; posten: Array<{ label: string; monat: number; gruppe: "gehalt" | "betrieb" }> };
  cashflow: Array<{ monat: string; einnahmen: number; ware: number; steuern: number; kosten: number; kredit: number; ueberschuss: number }>;
  checks: Array<{ titel: string; wert: string; text: string; ampel: Ampel; href: string }>;
  hy: { score: number; delta30: number | null; kg: number; schulden: number } | null;
}

const r0 = (n: number) => Math.round(n);
const plusMonate = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const eurKurz = (n: number) => `${Math.round(n).toLocaleString("de-DE")} €`;

async function alle<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await q(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Alles für die Finanz-Startseite — aus denselben Quellen wie Liquidität, HY-Score und USt-Übersicht. */
export async function ladeFinanzStart(): Promise<FinanzStart> {
  const sb = createServiceClient();
  const heute = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const jahr = Number(heute.slice(0, 4));
  const aktMonat = heute.slice(0, 7);
  const cfVon = `${plusMonate(aktMonat, -6)}-01`;

  const [{ roh, einstellungen: e, ergebnis: p }, hy, ustMonate, tx, shop] = await Promise.all([
    ladePrognose(),
    ladeHy(),
    ladeUstMonate(jahr, sb),
    alle<{ account_iban: string | null; booking_date: string; amount: number; kategorie: string | null }>((from, to) =>
      sb.from("bank_transactions").select("account_iban, booking_date, amount, kategorie").gte("booking_date", cfVon).order("booking_date").order("id").range(from, to),
    ),
    sb.from("shopify_umsatz_monat").select("monat, netto").gte("monat", `${jahr - 1}-01`).then((r) => (r.data ?? []) as Array<{ monat: string; netto: number }>),
  ]);

  // ── Konten ──
  const liste = roh.bankSalden.map((b) => ({
    name: b.iban === "PAYPAL" ? "PayPal" : kontoZweck(b.iban) ?? `Konto …${b.iban.slice(-4)}`,
    saldo: r0(b.saldo),
    stand: b.stand,
  }));
  const konten = { gesamt: r0(liste.reduce((s, k) => s + k.saldo, 0)), liste: liste.sort((a, b) => b.saldo - a.saldo) };

  // ── Umsatz ──
  const shopBy = new Map(shop.map((r) => [r.monat, Number(r.netto)]));
  const SALON = "DE56290501010084626001";
  const salonMonat = tx.filter((t) => t.account_iban === SALON && (t.kategorie ?? "").startsWith("ein_") && t.booking_date.startsWith(aktMonat)).reduce((s, t) => s + Number(t.amount), 0);
  const jahrShop = [...shopBy.entries()].filter(([m]) => m.startsWith(String(jahr))).reduce((s, [, v]) => s + v, 0);
  const jahrSalon = ustMonate.reduce((s, m) => s + m.salon, 0);
  const umsatz = {
    monat: aktMonat,
    shop: r0(shopBy.get(aktMonat) ?? 0),
    salon: r0(salonMonat),
    jahrShop: r0(jahrShop),
    jahrSalon: r0(jahrSalon),
    vorjahrMonatShop: shopBy.has(`${jahr - 1}-${aktMonat.slice(5)}`) ? r0(shopBy.get(`${jahr - 1}-${aktMonat.slice(5)}`)!) : null,
  };

  // ── Umsatzsteuer ──
  const fest = (m: UstMonat) => m.finanzamt !== null && m.quelle !== "schaetzung";
  const faellig = (m: string) => {
    const [y, mo] = m.split("-").map(Number);
    const d = new Date(Date.UTC(y, mo + 1, 10));
    return d.toISOString().slice(0, 10);
  };
  const offeneMonate = ustMonate.filter((m) => !fest(m)).map((m) => ({ monat: m.monat, betrag: m.berechnet, faellig: faellig(m.monat) }));
  const ust = {
    monate: ustMonate,
    abgerechnet: r0(ustMonate.filter(fest).reduce((s, m) => s + (m.finanzamt ?? 0), 0)),
    offen: r0(offeneMonate.reduce((s, m) => s + m.betrag, 0)),
    offeneMonate,
  };

  // ── Steuertermine (aus der Liquiditätsvorschau, nächste 60 Tage) ──
  const bis60 = new Date(Date.parse(`${p.start}T12:00:00Z`) + 60 * 864e5).toISOString().slice(0, 10);
  const steuerTermine = p.ereignisse
    .filter((x) => x.art === "steuer" && x.datum <= bis60)
    .map((x) => ({ datum: x.datum, label: x.label.replace(/\s*\((Schätzung|Soll) laut Vorauszahlungen\)/, ""), betrag: r0(x.betrag), geschaetzt: !!x.schaetzung }));

  // ── Fixkosten pro Monat (Ø der Basis-Monate der Liquidität; Gehaltskonto aufgeschlüsselt) ──
  const proMonat = (summe: number) => (summe / Math.max(1, roh.basis.tage)) * (365 / 12);
  const aus = new Set(e.ausgeblendeteKategorien);
  const basisVon = `${roh.basis.monate[0] ?? aktMonat}-01`;
  const basisBis = `${plusMonate(roh.basis.monate.at(-1) ?? aktMonat, 1)}-01`;
  const gehaltTx = tx.filter((t) => (t.account_iban ?? "").slice(4, 12) === "30020900" && Number(t.amount) < 0 && t.booking_date >= basisVon && t.booking_date < basisBis);
  const gehaltKat = new Map<string, number>();
  for (const t of gehaltTx) gehaltKat.set(t.kategorie ?? "unklar", (gehaltKat.get(t.kategorie ?? "unklar") ?? 0) + Number(t.amount));
  const GEHALT_LABEL: Record<string, string> = { aus_personal: "Gehälter (netto)", aus_sozialversicherung: "Krankenkassen / Sozialversicherung", aus_miete: "Miete + Lager", privat: "Privatentnahmen (kein Betriebsaufwand)", aus_versicherung: "Versicherungen" };
  const posten: FinanzStart["fixkosten"]["posten"] = [];
  for (const [k, summe] of gehaltKat) {
    if (k === "umbuchung" || k === "umbuchung_gehalt") continue;
    posten.push({ label: GEHALT_LABEL[k] ?? KATEGORIE_BY_KEY[k]?.label ?? k, monat: r0(proMonat(-summe)), gruppe: "gehalt" });
  }
  // Lohnsteuer läuft vom Shopify-Konto, gehört aber zu den Personalkosten
  const lst = tx.filter((t) => t.kategorie === "st_lohnsteuer" && t.booking_date >= basisVon && t.booking_date < basisBis).reduce((s, t) => s - Number(t.amount), 0);
  if (lst > 0) posten.push({ label: "Lohnsteuer", monat: r0(proMonat(lst)), gruppe: "gehalt" });
  for (const x of roh.basis.laufend) {
    if (aus.has(x.kategorie) || x.kategorie === "umbuchung_gehalt") continue;
    posten.push({ label: KATEGORIE_BY_KEY[x.kategorie]?.label ?? x.kategorie, monat: r0(proMonat(-x.summe)), gruppe: "betrieb" });
  }
  const fixPosten = posten.filter((x) => x.monat >= 50).sort((a, b) => b.monat - a.monat);
  const fixkosten = { summe: r0(fixPosten.reduce((s, x) => s + x.monat, 0)), posten: fixPosten };

  // ── Cashflow je Monat (Shopify- + Treatwell-Konto; Gehaltskonto über die Überträge) ──
  const cfMap = new Map<string, FinanzStart["cashflow"][number]>();
  for (const t of tx) {
    const iban = t.account_iban ?? "";
    if (iban.slice(4, 12) === "30020900" || iban === "PAYPAL") continue;
    const m = t.booking_date.slice(0, 7);
    if (m < plusMonate(aktMonat, -6) || m >= aktMonat) continue;
    const k = t.kategorie ?? "unklar";
    if (k === "umbuchung" || k === "kredit_auszahlung") continue;
    const c = cfMap.get(m) ?? { monat: m, einnahmen: 0, ware: 0, steuern: 0, kosten: 0, kredit: 0, ueberschuss: 0 };
    const b = Number(t.amount);
    if (k.startsWith("ein_")) c.einnahmen += b;
    else if (k === "aus_wareneinkauf") c.ware += b;
    else if (k.startsWith("st_")) c.steuern += b;
    else if (k === "aus_kredit") c.kredit += b;
    else c.kosten += b;
    cfMap.set(m, c);
  }
  const cashflow = [...cfMap.values()]
    .map((c) => ({ ...c, einnahmen: r0(c.einnahmen), ware: r0(c.ware), steuern: r0(c.steuern), kosten: r0(c.kosten), kredit: r0(c.kredit), ueberschuss: r0(c.einnahmen + c.ware + c.steuern + c.kosten) }))
    .sort((a, b) => a.monat.localeCompare(b.monat));

  // ── Gesundheits-Check ──
  const checks: FinanzStart["checks"] = [];
  const tief = p.tiefpunkt;
  checks.push({
    titel: "Liquidität",
    wert: eurKurz(tief.saldo),
    text: `Tiefster Kontostand in den nächsten ${e.horizontTage} Tagen (${tief.datum.slice(8, 10)}.${tief.datum.slice(5, 7)}.) — Reserve ${eurKurz(e.puffer)}`,
    ampel: tief.saldo < 0 ? "rot" : tief.saldo < e.puffer ? "gelb" : "gruen",
    href: "/finances/liquiditaet",
  });
  const ue = cashflow.length ? cashflow.reduce((s, c) => s + c.ueberschuss, 0) / cashflow.length : 0;
  checks.push({
    titel: "Überschuss im Monat",
    wert: `${ue >= 0 ? "+" : "−"}${eurKurz(Math.abs(ue))}`,
    text: `Ø der letzten ${cashflow.length} Monate: Einnahmen minus Ware, Steuern und alle Kosten (vor Kredit-Tilgung)`,
    ampel: ue < 0 ? "rot" : ue < 10_000 ? "gelb" : "gruen",
    href: "/finances/overview",
  });
  if (hy) {
    checks.push({
      titel: "Lieferantenschulden",
      wert: eurKurz(hy.schuldenEur),
      text: hy.delta30 != null ? `HY-Score ${hy.score.toLocaleString("de-DE")} (${hy.delta30 >= 0 ? "+" : ""}${hy.delta30.toLocaleString("de-DE")} in 30 Tagen) — Lager + Konten minus Schulden` : `HY-Score ${hy.score.toLocaleString("de-DE")}`,
      ampel: hy.delta30 == null ? "gelb" : hy.delta30 >= 0 ? "gruen" : "gelb",
      href: "/health",
    });
    const verbrauch = (roh.nachbestellung.kgVerbrauchMonat ?? 0) + (roh.ebruNachbestellung?.kgVerbrauchMonat ?? 0);
    if (verbrauch > 0) {
      const reichweite = hy.kg / verbrauch;
      checks.push({
        titel: "Lager-Reichweite",
        wert: `${reichweite.toLocaleString("de-DE", { maximumFractionDigits: 1 })} Monate`,
        text: `${Math.round(hy.kg).toLocaleString("de-DE")} kg im Lager bei ${verbrauch.toLocaleString("de-DE", { maximumFractionDigits: 1 })} kg Verkauf/Monat — viel Lager bindet Geld`,
        ampel: reichweite > 12 ? "rot" : reichweite > 6 ? "gelb" : "gruen",
        href: "/stock/deadstock",
      });
    }
  }
  const personal = fixPosten.filter((x) => x.gruppe === "gehalt" && x.label !== "Miete + Lager" && !x.label.startsWith("Privatentnahmen") && x.label !== "Versicherungen").reduce((s, x) => s + x.monat, 0);
  const einnahmenMonat = p.einnahmenProTag * (365 / 12);
  if (einnahmenMonat > 0 && personal > 0) {
    const quote = personal / einnahmenMonat;
    checks.push({
      titel: "Personalquote",
      wert: `${(quote * 100).toLocaleString("de-DE", { maximumFractionDigits: 0 })} %`,
      text: `${eurKurz(personal)} Personal pro Monat (Gehälter, Sozialversicherung, Lohnsteuer) von ${eurKurz(einnahmenMonat)} Einnahmen`,
      ampel: quote > 0.35 ? "rot" : quote > 0.25 ? "gelb" : "gruen",
      href: "/staff",
    });
  }
  checks.push({
    titel: "Umsatzsteuer offen",
    wert: `${ust.offen >= 0 ? "" : "−"}${eurKurz(Math.abs(ust.offen))}`,
    text: ust.offen >= 0 ? "grob aus den Umsätzen: noch zu zahlen" : "grob aus den Umsätzen: kommt noch zurück",
    ampel: "info",
    href: "/finances/prepayments",
  });

  return {
    stand: new Date().toISOString(),
    konten,
    liquiditaet: { tiefpunkt: tief, puffer: e.puffer, ende: p.tage.at(-1) ?? null },
    umsatz,
    ust,
    steuerTermine,
    fixkosten,
    cashflow,
    checks,
    hy: hy ? { score: hy.score, delta30: hy.delta30, kg: hy.kg, schulden: hy.schuldenEur } : null,
  };
}
