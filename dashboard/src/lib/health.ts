// Firmen-Gesundheit — automatische Kennzahl (server-only, service_role).
// Aufrufer prüfen vorher requireFeature("finances") bzw. laufen als Cron.
//
// Kennzahl (User-Definition, unverändert): Lager kg + Konten/1000 − Schulden/1000
//   Konten   = FinTS-/PayPal-Salden (bank_salden)
//   Schulden = Lieferanten "fällig" laut order-debt (Ware unterwegs/da, Sammelrechnungen)
//            + offene Steuer-Soll-Posten (eingetragen, noch nicht bezahlt, Zeitraum begonnen)
//            + manuelle Ergänzungen (weitere Schulden, Steuer-Rückstellung)
// Bestellungen in Produktion zählen bewusst NICHT: deren kg sind auch noch nicht im Lager.
import { createServiceClient } from "@/lib/supabase/server";
import { debtBucket } from "@/lib/order-debt";
import { mitDefaults, parseFxKurs } from "@/lib/liquiditaet/rechnung";
import type { OrderStatus } from "@/lib/types";

type Sb = ReturnType<typeof createServiceClient>;

export interface HealthKonto {
  key: string;
  name: string;
  saldo: number;
  stand: string | null;
}

export interface HealthSchuld {
  name: string;
  eur: number;
  usd?: number;
}

export interface HealthErgaenzungen {
  weitere_schulden_eur: number;
  steuer_rueckstellung_eur: number;
}

export interface HealthDetails {
  konten: HealthKonto[];
  lieferanten: HealthSchuld[];
  steuern: HealthSchuld[];
  ergaenzungen: HealthErgaenzungen;
  kommend: { usd: number; eur: number; anzahl: number };
  fx: { kurs: number; quelle: "manuell" | "auto" | "standard"; datum: string | null };
  kontenStand: string | null;
}

export interface HealthBerechnung {
  kontenEur: number;
  lieferantenEur: number;
  steuernEur: number;
  ergaenzungenEur: number;
  schuldenEur: number;
  details: HealthDetails;
}

const KONTO_NAMEN: Record<string, string> = {
  DE55290501010084626019: "Sparkasse …6019 (Shop)",
  DE56290501010084626001: "Sparkasse …6001 (Salon)",
  DE21300209005360977267: "Targobank (Gehaltskonto)",
  PAYPAL: "PayPal",
};

const STEUER_NAMEN: Record<string, string> = {
  ust_va: "USt-Voranmeldung",
  ust_nachzahlung: "USt-Nachzahlung",
  eust: "Einfuhrumsatzsteuer",
  lst_anmeldung: "Lohnsteuer",
  est_vz: "ESt-Vorauszahlung",
  est_nachzahlung: "ESt-Nachzahlung",
  gewst_vz: "GewSt-Vorauszahlung",
  gewst_nachzahlung: "GewSt-Nachzahlung",
  sonstige: "Sonstige Steuer",
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Kennzahl-Formel (User-Definition): kg + Konten/1000 − Schulden/1000. */
export function healthScore(stockKg: number, kontenEur: number, schuldenEur: number): number {
  return Math.round((stockKg + kontenEur / 1000 - schuldenEur / 1000) * 10) / 10;
}

/** Beginn des Steuer-Zeitraums ("2026-09", "Q3 2026", "2025"); null = unbekanntes Format. */
export function zeitraumBeginn(z: string): string | null {
  if (/^\d{4}-\d{2}$/.test(z)) return `${z}-01`;
  const q = z.match(/^Q([1-4]) (\d{4})$/);
  if (q) return `${q[2]}-${String((Number(q[1]) - 1) * 3 + 1).padStart(2, "0")}-01`;
  if (/^\d{4}$/.test(z)) return `${z}-01-01`;
  return null;
}

export interface SteuerPostenRoh {
  art: string;
  zeitraum: string;
  richtung: string;
  soll_betrag: number;
  ist_betrag: number;
  bezahlt_am: string | null;
  soll_schaetzung: boolean;
}

/**
 * Offene Steuern zum Stichtag d: Zeitraum hat begonnen und bis d nicht bezahlt.
 * Betrag = Ist (falls inzwischen bekannt) sonst Soll; Erstattungen mindern.
 * Ist ohne Zahldatum gilt als bezahlt (Zeitpunkt unbekannt).
 */
export function steuernOffenAm(posten: SteuerPostenRoh[], d: string): HealthSchuld[] {
  return posten
    .filter((p) => {
      const b = zeitraumBeginn(p.zeitraum);
      if (b != null && b > d) return false;
      const ist = Number(p.ist_betrag);
      if (ist !== 0 && (!p.bezahlt_am || String(p.bezahlt_am).slice(0, 10) <= d)) return false;
      return (ist !== 0 ? ist : Number(p.soll_betrag)) > 0;
    })
    .map((p) => {
      const ist = Number(p.ist_betrag);
      const schaetzung = ist === 0 && p.soll_schaetzung;
      return {
        name: `${STEUER_NAMEN[p.art] ?? p.art} ${p.zeitraum}${schaetzung ? " (≈ Schätzung)" : ""}`,
        eur: r2((p.richtung === "erstattung" ? -1 : 1) * (ist !== 0 ? ist : Number(p.soll_betrag))),
      };
    });
}

function heuteBerlin(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
}

/** Letzte Ergänzungen (aus dem jüngsten Eintrag, der welche trägt). */
async function ladeErgaenzungen(sb: Sb): Promise<HealthErgaenzungen> {
  const { data } = await sb
    .from("company_health_snapshots")
    .select("details")
    .not("details", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const e = (data?.details as Partial<HealthDetails> | null)?.ergaenzungen;
  return {
    weitere_schulden_eur: Number(e?.weitere_schulden_eur ?? 0),
    steuer_rueckstellung_eur: Number(e?.steuer_rueckstellung_eur ?? 0),
  };
}

export async function berechneHealth(
  sb: Sb = createServiceClient(),
  ergaenzungenOverride?: HealthErgaenzungen,
): Promise<HealthBerechnung> {
  const heute = heuteBerlin();
  const [{ data: salden }, { data: orders }, { data: posten }, { data: fxTx }, { data: einst }, ergaenzungenGespeichert] = await Promise.all([
    sb.from("bank_salden").select("account_iban, saldo, stand"),
    sb.from("orders_with_totals")
      .select("label, status, remaining_balance, suppliers(name)")
      .gt("remaining_balance", 0)
      .not("status", "in", "(draft,cancelled,hidden)"),
    sb.from("steuer_posten").select("art, zeitraum, richtung, soll_betrag, ist_betrag, bezahlt_am, soll_schaetzung"),
    sb.from("bank_transactions")
      .select("booking_date, purpose")
      .ilike("purpose", "%USD%")
      .order("booking_date", { ascending: false })
      .limit(30),
    sb.from("liquiditaet_einstellungen").select("daten").eq("id", 1).maybeSingle(),
    ergaenzungenOverride ? Promise.resolve(ergaenzungenOverride) : null,
  ]);
  const ergaenzungen = ergaenzungenGespeichert ?? (await ladeErgaenzungen(sb));

  // ── Wechselkurs: wie in der Liquiditätsvorschau (manuell > letzte Auslandsüberweisung > 1,10) ──
  const manuellFx = mitDefaults((einst?.daten ?? {}) as Parameters<typeof mitDefaults>[0]).fxUsdProEur;
  let autoFx: { kurs: number; datum: string } | null = null;
  for (const t of (fxTx ?? []) as Array<{ booking_date: string; purpose: string | null }>) {
    const k = parseFxKurs(t.purpose);
    if (k) { autoFx = { kurs: k, datum: t.booking_date }; break; }
  }
  const fx: HealthDetails["fx"] = manuellFx
    ? { kurs: manuellFx, quelle: "manuell", datum: null }
    : autoFx
      ? { kurs: autoFx.kurs, quelle: "auto", datum: autoFx.datum }
      : { kurs: 1.1, quelle: "standard", datum: null };

  // ── Konten ──
  const konten: HealthKonto[] = ((salden ?? []) as Array<{ account_iban: string; saldo: number; stand: string | null }>)
    .map((s) => ({
      key: s.account_iban,
      name: KONTO_NAMEN[s.account_iban] ?? `Konto …${s.account_iban.slice(-4)}`,
      saldo: r2(Number(s.saldo)),
      stand: s.stand ? String(s.stand).slice(0, 10) : null,
    }))
    .sort((a, b) => b.saldo - a.saldo);
  const kontenStand = konten.map((k) => k.stand).filter(Boolean).sort()[0] ?? null;

  // ── Lieferanten: fällig zählt, in Produktion nur zur Info ──
  const proLieferant = new Map<string, number>();
  const kommend = { usd: 0, eur: 0, anzahl: 0 };
  for (const o of (orders ?? []) as Array<{ status: string; remaining_balance: number; suppliers: { name: string } | { name: string }[] | null }>) {
    const usd = Number(o.remaining_balance);
    const sup = Array.isArray(o.suppliers) ? o.suppliers[0] : o.suppliers;
    const bucket = debtBucket({ status: o.status as OrderStatus });
    if (bucket === "due") proLieferant.set(sup?.name ?? "Lieferant", (proLieferant.get(sup?.name ?? "Lieferant") ?? 0) + usd);
    else if (bucket === "upcoming") { kommend.usd += usd; kommend.anzahl++; }
  }
  kommend.usd = r2(kommend.usd);
  kommend.eur = r2(kommend.usd / fx.kurs);
  const lieferanten: HealthSchuld[] = [...proLieferant.entries()]
    .map(([name, usd]) => ({ name, usd: r2(usd), eur: r2(usd / fx.kurs) }))
    .sort((a, b) => b.eur - a.eur);

  // ── Steuern: Zeitraum begonnen, noch nicht bezahlt (gleiche Regel wie im Monatsverlauf) ──
  const steuern = steuernOffenAm((posten ?? []) as SteuerPostenRoh[], heute);

  const kontenEur = r2(konten.reduce((s, k) => s + k.saldo, 0));
  const lieferantenEur = r2(lieferanten.reduce((s, l) => s + l.eur, 0));
  const steuernEur = r2(steuern.reduce((s, l) => s + l.eur, 0));
  const ergaenzungenEur = r2(ergaenzungen.weitere_schulden_eur + ergaenzungen.steuer_rueckstellung_eur);
  return {
    kontenEur,
    lieferantenEur,
    steuernEur,
    ergaenzungenEur,
    schuldenEur: r2(lieferantenEur + steuernEur + ergaenzungenEur),
    details: { konten, lieferanten, steuern, ergaenzungen, kommend, fx, kontenStand },
  };
}

/** Konten auf die alten Spalten verteilen (Verlauf bleibt lesbar). */
export function kontenSpalten(konten: HealthKonto[]): { treatwell_eur: number; shopify_eur: number; targobank_eur: number } {
  const get = (k: string) => konten.find((x) => x.key === k)?.saldo ?? 0;
  const salon = get("DE56290501010084626001");
  const targo = get("DE21300209005360977267");
  const rest = r2(konten.reduce((s, k) => s + k.saldo, 0) - salon - targo);
  return { treatwell_eur: salon, shopify_eur: rest, targobank_eur: targo };
}

/**
 * Eintrag im Verlauf speichern. auto=true (Cron): pro Tag höchstens ein Auto-Eintrag —
 * ein zweiter Lauf innerhalb von 20 h aktualisiert ihn.
 */
export async function speichereHealthSnapshot(
  sb: Sb,
  opts: { auto: boolean; note?: string | null; createdBy?: string | null; ergaenzungen?: HealthErgaenzungen },
): Promise<{ ok: boolean; score?: number | null; error?: string }> {
  const h = await berechneHealth(sb, opts.ergaenzungen);
  let ruKg: number | null = null;
  let uzKg: number | null = null;
  let score: number | null = null;
  try {
    const { getTotalStockKg } = await import("@/lib/stock-sheets");
    const stock = await getTotalStockKg();
    // Teilweise gelesene Sheets nicht als echten Wert einfrieren
    if (!stock.partial) {
      ruKg = stock.russianKg;
      uzKg = stock.uzbekKg;
      score = healthScore(stock.totalKg, h.kontenEur, h.schuldenEur);
    }
  } catch (e) {
    console.warn("[health] kg nicht lesbar:", e instanceof Error ? e.message : e);
  }
  if (opts.auto && score == null) return { ok: false, error: "Lager nicht lesbar — Auto-Eintrag übersprungen" };

  const row = {
    ...kontenSpalten(h.details.konten),
    debt_eur: h.schuldenEur,
    stock_kg_russian: ruKg,
    stock_kg_uzbek: uzKg,
    score,
    note: opts.note ?? null,
    details: h.details,
    auto: opts.auto,
    created_by: opts.createdBy ?? null,
  };

  if (opts.auto) {
    // Cron läuft täglich — "heute schon einer da" = jünger als 20 h
    const tagStart = new Date(Date.now() - 20 * 3600_000).toISOString();
    const { data: vorhanden } = await sb
      .from("company_health_snapshots")
      .select("id")
      .eq("auto", true)
      .gte("created_at", tagStart)
      .limit(1)
      .maybeSingle();
    if (vorhanden) {
      const { error } = await sb.from("company_health_snapshots").update(row).eq("id", vorhanden.id);
      return error ? { ok: false, error: error.message } : { ok: true, score };
    }
  }
  const { error } = await sb.from("company_health_snapshots").insert(row);
  return error ? { ok: false, error: error.message } : { ok: true, score };
}

// ── Monatsverlauf ───────────────────────────────────────────────────────────

export interface HealthMonat {
  monat: string; // "2026-09"
  stichtag: string; // Monatsende bzw. heute
  live: boolean;
  kg: number | null;
  kontenEur: number;
  paypalEur: number | null; // null = für diesen Monat kein PayPal-Stand bekannt
  lieferantenEur: number;
  steuernEur: number;
  ergaenzungenEur: number;
  schuldenEur: number;
  score: number | null;
}

interface VerlaufOrder {
  id: string;
  status: string;
  order_date: string | null;
  invoice_effective: number | null;
}

function monatsEnde(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
}

function naechsterMonat(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
}

/**
 * Status einer Bestellung am Stichtag d (aus der Status-Historie).
 * Sammelrechnungen (manual) zählen ab Rechnungsdatum — sie werden oft erst später erfasst.
 * null = Bestellung gab es zum Stichtag noch nicht (bzw. noch nicht im System).
 */
export function statusAm(
  o: Pick<VerlaufOrder, "status" | "order_date">,
  events: Array<{ created_at: string; to: string }>,
  d: string,
): string | null {
  if (o.status === "manual") return o.order_date && o.order_date.slice(0, 10) <= d ? "manual" : null;
  let st: string | null = null;
  for (const e of events) if (e.created_at.slice(0, 10) <= d) st = e.to; // events aufsteigend sortiert
  return st;
}

async function alleZeilen<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/**
 * Kennzahl je Monatsende, immer aus den aktuellen Daten neu gerechnet (später eingetragene
 * Steuer-Ist-Werte oder Zahlungen korrigieren also auch die Vergangenheit).
 *   Lager    = letzter Lager-Snapshot im Monat (stock_snapshots)
 *   Konten   = heutiger Bankstand − Buchungen nach dem Stichtag; PayPal nur, wo ein Verlaufs-Eintrag im Monat ihn kennt
 *   Schulden = Lieferanten "fällig" zum Stichtag + offene Steuern zum Stichtag + Ergänzungen des letzten Eintrags davor
 * Der laufende Monat kommt live (berechneHealth + Live-Lager).
 * Startmonat = erster Monat mit Lager-Snapshot (davor keine kg-Historie).
 */
export async function ladeHealthVerlauf(
  sb: Sb,
  live: { kg: number | null; h: HealthBerechnung },
): Promise<HealthMonat[]> {
  const heute = heuteBerlin();
  const aktMonat = heute.slice(0, 7);
  const { data: ersterStock } = await sb.from("stock_snapshots").select("taken_on").order("taken_on").limit(1).maybeSingle();
  const startMonat = ersterStock?.taken_on ? String(ersterStock.taken_on).slice(0, 7) : aktMonat;
  const seit = `${startMonat}-01`;

  const [stocks, tx, fxTx, orders, payments, events, posten, snaps, { data: salden }] = await Promise.all([
    alleZeilen<{ taken_on: string; total_kg: number }>((f, t) =>
      sb.from("stock_snapshots").select("taken_on, total_kg").order("taken_on").range(f, t)),
    alleZeilen<{ account_iban: string; booking_date: string; amount: number }>((f, t) =>
      sb.from("bank_transactions").select("account_iban, booking_date, amount").gt("booking_date", monatsEnde(startMonat)).order("id").range(f, t)),
    alleZeilen<{ booking_date: string; purpose: string | null }>((f, t) =>
      sb.from("bank_transactions").select("booking_date, purpose").ilike("purpose", "%USD%").order("booking_date").range(f, t)),
    alleZeilen<VerlaufOrder>((f, t) =>
      sb.from("orders_with_totals").select("id, status, order_date, invoice_effective").not("status", "in", "(draft,cancelled,hidden)").range(f, t)),
    alleZeilen<{ order_id: string; amount: number; paid_at: string }>((f, t) =>
      sb.from("payments").select("order_id, amount, paid_at").range(f, t)),
    alleZeilen<{ order_id: string; meta: { to?: string; status?: string } | null; created_at: string }>((f, t) =>
      sb.from("order_events").select("order_id, meta, created_at").eq("event_type", "status_change").order("created_at").range(f, t)),
    alleZeilen<SteuerPostenRoh>((f, t) =>
      sb.from("steuer_posten").select("art, zeitraum, richtung, soll_betrag, ist_betrag, bezahlt_am, soll_schaetzung").range(f, t)),
    alleZeilen<{ created_at: string; details: HealthDetails | null }>((f, t) =>
      sb.from("company_health_snapshots").select("created_at, details").not("details", "is", null).order("created_at").range(f, t)),
    sb.from("bank_salden").select("account_iban, saldo"),
  ]);

  const evByOrder = new Map<string, Array<{ created_at: string; to: string }>>();
  for (const e of events) {
    const to = e.meta?.to ?? e.meta?.status;
    if (!to) continue;
    const list = evByOrder.get(e.order_id) ?? [];
    list.push({ created_at: e.created_at, to });
    evByOrder.set(e.order_id, list);
  }
  const fxPunkte = fxTx.map((t) => ({ d: t.booking_date, k: parseFxKurs(t.purpose) })).filter((x): x is { d: string; k: number } => x.k != null);
  const bankJetzt = ((salden ?? []) as Array<{ account_iban: string; saldo: number }>).filter((s) => s.account_iban !== "PAYPAL");

  const monate: HealthMonat[] = [];
  for (let m = startMonat; m <= aktMonat; m = naechsterMonat(m)) {
    if (m === aktMonat) {
      const h = live.h;
      const paypal = h.details.konten.find((k) => k.key === "PAYPAL")?.saldo ?? null;
      monate.push({
        monat: m, stichtag: heute, live: true, kg: live.kg,
        kontenEur: h.kontenEur, paypalEur: paypal,
        lieferantenEur: h.lieferantenEur, steuernEur: h.steuernEur, ergaenzungenEur: h.ergaenzungenEur,
        schuldenEur: h.schuldenEur,
        score: live.kg != null ? healthScore(live.kg, h.kontenEur, h.schuldenEur) : null,
      });
      break;
    }
    const d = monatsEnde(m);

    const stock = stocks.filter((s) => String(s.taken_on).slice(0, 7) === m).at(-1);
    const kg = stock ? Number(stock.total_kg) : null;

    // Bankkonten: heutiger Stand minus alles, was nach dem Stichtag gebucht wurde
    let bank = 0;
    for (const b of bankJetzt) {
      bank += Number(b.saldo) - tx.filter((t) => t.account_iban === b.account_iban && t.booking_date > d).reduce((s, t) => s + Number(t.amount), 0);
    }
    const snapImMonat = snaps.filter((s) => s.created_at.slice(0, 7) === m).at(-1);
    const paypal = snapImMonat?.details?.konten?.find((k) => k.key === "PAYPAL")?.saldo ?? null;
    const kontenEur = r2(bank + (paypal ?? 0));

    // Lieferanten fällig zum Stichtag, Kurs der letzten Auslandsüberweisung bis dahin
    const fx = fxPunkte.filter((p) => p.d <= d).at(-1)?.k ?? live.h.details.fx.kurs;
    let usd = 0;
    for (const o of orders) {
      const st = statusAm(o, evByOrder.get(o.id) ?? [], d);
      if (!st || debtBucket({ status: st as OrderStatus }) !== "due") continue;
      const bezahlt = payments.filter((p) => p.order_id === o.id && String(p.paid_at).slice(0, 10) <= d).reduce((s, p) => s + Number(p.amount), 0);
      usd += Math.max(0, Number(o.invoice_effective ?? 0) - bezahlt);
    }
    const lieferantenEur = r2(usd / fx);

    const steuernEur = r2(steuernOffenAm(posten, d).reduce((s, x) => s + x.eur, 0));
    const erg = snaps.filter((s) => s.created_at.slice(0, 10) <= d).at(-1)?.details?.ergaenzungen;
    const ergaenzungenEur = r2(Number(erg?.weitere_schulden_eur ?? 0) + Number(erg?.steuer_rueckstellung_eur ?? 0));
    const schuldenEur = r2(lieferantenEur + steuernEur + ergaenzungenEur);

    monate.push({
      monat: m, stichtag: d, live: false, kg, kontenEur, paypalEur: paypal,
      lieferantenEur, steuernEur, ergaenzungenEur, schuldenEur,
      score: kg != null ? healthScore(kg, kontenEur, schuldenEur) : null,
    });
  }
  return monate;
}
