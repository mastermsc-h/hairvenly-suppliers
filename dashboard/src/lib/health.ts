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
    sb.from("steuer_posten")
      .select("art, zeitraum, richtung, soll_betrag, ist_betrag, soll_schaetzung")
      .eq("ist_betrag", 0)
      .gt("soll_betrag", 0),
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

  // ── Steuern: eingetragenes Soll ohne Ist, Zeitraum hat begonnen (Erstattungen mindern) ──
  const steuern: HealthSchuld[] = ((posten ?? []) as Array<{ art: string; zeitraum: string; richtung: string; soll_betrag: number; soll_schaetzung: boolean }>)
    .filter((p) => {
      const b = zeitraumBeginn(p.zeitraum);
      return b == null || b <= heute;
    })
    .map((p) => ({
      name: `${STEUER_NAMEN[p.art] ?? p.art} ${p.zeitraum}${p.soll_schaetzung ? " (≈ Schätzung)" : ""}`,
      eur: r2((p.richtung === "erstattung" ? -1 : 1) * Number(p.soll_betrag)),
    }));

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
