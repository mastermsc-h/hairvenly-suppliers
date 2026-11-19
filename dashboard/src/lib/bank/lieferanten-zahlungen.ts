/**
 * Überweisungen an Auslandslieferanten (Ebru = JUANCHENG, Amanda = YW BEAUTY) aus den
 * Kontoumsätzen erkennen und als Zahlung bei der passenden Position eintragen, wenn die
 * Kollegen das vergessen haben.
 *
 * Vorsichtig per Design: gebucht wird nur bei eindeutiger Zuordnung über die Rechnungsnummer
 * im Verwendungszweck. Alles andere bleibt "unklar" und wird im Dashboard angezeigt.
 * Jeder Kontoumsatz wird genau einmal verarbeitet (bank_transactions.lieferant_zahlung).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface LzTx {
  id: string;
  booking_date: string; // YYYY-MM-DD
  counterparty_name: string | null;
  purpose: string | null;
}

export interface LzOrder {
  id: string;
  label: string;
  status: string;
  order_date: string | null;
  remaining_balance: number;
}

export interface LzPayment {
  order_id: string;
  paid_at: string;
  amount: number;
}

export interface LzLieferant {
  key: "ebru" | "amanda";
  name: string;
  bank: RegExp;
}

export const LZ_LIEFERANTEN: LzLieferant[] = [
  { key: "ebru", name: "Ebru", bank: /JUANCHENG/i },
  { key: "amanda", name: "Amanda", bank: /YW\s*BEAUTY/i },
];

/** Ab diesem Buchungstag wird automatisch eingetragen (ältere Zahlungen liefen vor dem Dashboard). */
export const LZ_AB = "2026-10-01";

const NICHT_OFFEN = new Set(["draft", "cancelled", "hidden"]);

export function lieferantVon(counterparty: string | null): LzLieferant | null {
  return LZ_LIEFERANTEN.find((l) => l.bank.test(counterparty ?? "")) ?? null;
}

/** USD-Betrag aus dem Verwendungszweck (beide Sparkassen-Formate). */
export function parseUsd(purpose: string | null): number | null {
  const p = (purpose ?? "").replace(/\s+/g, " ");
  const m = p.match(/BETRAG\.\s*USD\s*-?([\d.]+,\d{2})/i) ?? p.match(/USD\s?([\d.]+,\d{2})\s+\d,\d{3,5}/i);
  if (!m) return null;
  const v = Number(m[1].replace(/\./g, "").replace(",", "."));
  return v > 0 ? v : null;
}

export interface LzRechnung {
  nr: string; // z.B. "EHL20260616" / "AMANDAGRM20260821"
  datum: string | null; // YYYY-MM-DD aus der Nummer
  teil: number | null; // "-Part 2" → 2
}

export function parseRechnung(purpose: string | null): LzRechnung | null {
  const p = (purpose ?? "").toUpperCase().replace(/\s+/g, "");
  const m = p.match(/(EHL|AMANDAGRM)(\d{8})(?:-?PART(\d))?/);
  if (!m) return null;
  const d = m[2];
  return { nr: `${m[1]}${d}`, datum: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, teil: m[3] ? Number(m[3]) : null };
}

const tage = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

export type LzErgebnis =
  | { art: "vorhanden"; orderId: string; usd: number; rechnung: string | null }
  | { art: "buchen"; orderId: string; label: string; usd: number; rechnung: string }
  | { art: "unklar"; usd: number | null; rechnung: string | null; grund: string };

/**
 * Entscheidet für eine Überweisung: schon eingetragen, eindeutig zuzuordnen oder unklar.
 * orders/payments = nur die des betreffenden Lieferanten.
 */
export function entscheide(tx: LzTx, lieferant: LzLieferant, orders: LzOrder[], payments: LzPayment[]): LzErgebnis {
  const usd = parseUsd(tx.purpose);
  const re = parseRechnung(tx.purpose);
  if (!usd) return { art: "unklar", usd: null, rechnung: re?.nr ?? null, grund: "USD-Betrag nicht im Verwendungszweck" };

  // Schon von Hand eingetragen? Gleicher Betrag (±1 $) innerhalb von 21 Tagen.
  const da = payments.find((p) => Math.abs(Number(p.amount) - usd) < 1 && Math.abs(tage(p.paid_at.slice(0, 10), tx.booking_date)) <= 21);
  if (da) return { art: "vorhanden", orderId: da.order_id, usd, rechnung: re?.nr ?? null };

  if (!re) return { art: "unklar", usd, rechnung: null, grund: "keine Rechnungsnummer im Verwendungszweck" };
  const offen = orders.filter((o) => !NICHT_OFFEN.has(o.status) && o.remaining_balance > 0.01);
  let kandidaten: LzOrder[];

  if (lieferant.key === "ebru") {
    // Ebru: Position trägt die Rechnungsnummer im Namen (z.B. "EHL20260616", "EHL20261026 China 21.08.2026")
    kandidaten = offen
      .filter((o) => o.label.toUpperCase().replace(/\s+/g, "").includes(re.nr))
      .sort((a, b) => (a.order_date ?? "").localeCompare(b.order_date ?? ""));
    if (!kandidaten.length) return { art: "unklar", usd, rechnung: re.nr, grund: `keine offene Position mit „${re.nr}“` };
    // Mehrere Positionen zu einer Rechnung: älteste zuerst (Ratenzahlung)
    const ziel = kandidaten.find((o) => o.remaining_balance + 1 >= usd);
    if (!ziel) return { art: "unklar", usd, rechnung: re.nr, grund: "Betrag größer als der offene Rest" };
    return { art: "buchen", orderId: ziel.id, label: ziel.label, usd, rechnung: re.nr };
  }

  // Amanda: Rechnungsdatum ≈ Bestelldatum (0–7 Tage danach), "-Part N" → Position "(… pt. N)"
  if (!re.datum) return { art: "unklar", usd, rechnung: re.nr, grund: "Rechnungsdatum nicht lesbar" };
  kandidaten = offen.filter((o) => o.order_date && Math.abs(tage(o.order_date, re.datum!)) <= 7);
  if (re.teil) {
    const teil = kandidaten.filter((o) => new RegExp(`\\bpt\\.?\\s*${re.teil}\\b`, "i").test(o.label));
    if (teil.length === 1) kandidaten = teil;
  }
  // Betrag = genau der offene Rest einer Position → eindeutig
  const exakt = kandidaten.filter((o) => Math.abs(o.remaining_balance - usd) < 1);
  if (exakt.length === 1) kandidaten = exakt;
  if (kandidaten.length > 1) {
    // Nächstes Bestelldatum vor/an der Rechnung, wenn nur eine Position so nah liegt
    const vorher = kandidaten.filter((o) => tage(o.order_date!, re.datum!) >= 0 && tage(o.order_date!, re.datum!) <= 3);
    if (vorher.length === 1) kandidaten = vorher;
  }
  if (kandidaten.length !== 1) {
    return { art: "unklar", usd, rechnung: re.nr, grund: kandidaten.length ? `${kandidaten.length} Positionen kommen in Frage` : "keine offene Position zum Rechnungsdatum" };
  }
  const ziel = kandidaten[0];
  if (usd > ziel.remaining_balance + 1) return { art: "unklar", usd, rechnung: re.nr, grund: `Betrag größer als der offene Rest von „${ziel.label}“` };
  return { art: "buchen", orderId: ziel.id, label: ziel.label, usd, rechnung: re.nr };
}

// ── Lauf gegen die Datenbank ────────────────────────────────────────────────

const fmtUsd = (n: number) => n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDatum = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

export interface LzLaufErgebnis {
  geprueft: number;
  gebucht: Array<{ label: string; usd: number; datum: string; rechnung: string }>;
  vorhanden: number;
  unklar: number;
  errors: string[];
}

/** Verarbeitet alle noch nicht verarbeiteten Überweisungen an Ebru/Amanda ab LZ_AB. */
export async function lieferantenZahlungenAbgleichen(sb: SupabaseClient, opts: { dryRun?: boolean } = {}): Promise<LzLaufErgebnis> {
  const res: LzLaufErgebnis = { geprueft: 0, gebucht: [], vorhanden: 0, unklar: 0, errors: [] };
  const { data: txs, error } = await sb
    .from("bank_transactions")
    .select("id, booking_date, counterparty_name, purpose, amount")
    .lt("amount", 0)
    .gte("booking_date", LZ_AB)
    .is("lieferant_zahlung", null)
    .or(LZ_LIEFERANTEN.map((l) => `counterparty_name.ilike.%${l.key === "ebru" ? "juancheng" : "yw beauty"}%`).join(","))
    .order("booking_date", { ascending: true });
  if (error) return { ...res, errors: [error.message] };
  if (!txs?.length) return res;

  const { data: sups } = await sb.from("suppliers").select("id, name");
  for (const tx of txs as Array<LzTx & { amount: number }>) {
    const l = lieferantVon(tx.counterparty_name);
    if (!l) continue;
    res.geprueft++;
    const supIds = (sups ?? []).filter((s) => String(s.name).toLowerCase().includes(l.name.toLowerCase())).map((s) => s.id as string);
    const [{ data: orders }, { data: pays }] = await Promise.all([
      sb.from("orders_with_totals").select("id, label, status, order_date, remaining_balance").in("supplier_id", supIds),
      sb.from("payments").select("order_id, paid_at, amount, orders!inner(supplier_id)").in("orders.supplier_id", supIds),
    ]);
    const e = entscheide(
      { ...tx, booking_date: String(tx.booking_date).slice(0, 10) },
      l,
      ((orders ?? []) as LzOrder[]).map((o) => ({ ...o, remaining_balance: Number(o.remaining_balance) })),
      (pays ?? []) as unknown as LzPayment[],
    );
    if (opts.dryRun) {
      if (e.art === "buchen") res.gebucht.push({ label: e.label, usd: e.usd, datum: tx.booking_date, rechnung: e.rechnung });
      else if (e.art === "vorhanden") res.vorhanden++;
      else res.unklar++;
      continue;
    }
    try {
      if (e.art === "buchen") {
        const datum = String(tx.booking_date).slice(0, 10);
        const hinweis = `Automatisch aus Kontoumsätzen eingetragen (Überweisung ${fmtDatum(datum)}, Rechnung ${e.rechnung})`;
        const { error: insErr } = await sb.from("payments").insert({
          order_id: e.orderId, amount: e.usd, paid_at: datum, method: "spk", note: hinweis,
          bank_transaction_id: tx.id, auto_added: true,
        });
        if (insErr) throw new Error(insErr.message);
        const { data: o } = await sb.from("orders").select("notes").eq("id", e.orderId).single();
        const zeile = `[Auto ${fmtDatum(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date()))}] Zahlung ${fmtUsd(e.usd)} $ vom ${fmtDatum(datum)} automatisch aus den Kontoumsätzen hinzugefügt (Rechnung ${e.rechnung}) – bitte prüfen.`;
        await sb.from("orders").update({ notes: o?.notes ? `${o.notes}\n${zeile}` : zeile }).eq("id", e.orderId);
        await sb.from("order_events").insert({ order_id: e.orderId, event_type: "payment", message: `Zahlung automatisch hinzugefügt: ${fmtUsd(e.usd)} USD (${hinweis})`, actor_id: null });
        res.gebucht.push({ label: e.label, usd: e.usd, datum, rechnung: e.rechnung });
      } else if (e.art === "vorhanden") {
        res.vorhanden++;
      } else {
        res.unklar++;
      }
      await sb.from("bank_transactions").update({
        lieferant_zahlung: e.art === "buchen" ? "gebucht" : e.art,
        lieferant_zahlung_info: { ...e, lieferant: l.name, geprueft_am: new Date().toISOString() },
      }).eq("id", tx.id);
    } catch (err) {
      res.errors.push(`${tx.booking_date} ${l.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return res;
}

/** Überweisungen, die keiner Position zugeordnet werden konnten (für den Hinweis im Dashboard). */
export async function unklareLieferantenZahlungen(sb: SupabaseClient) {
  const { data } = await sb
    .from("bank_transactions")
    .select("id, booking_date, counterparty_name, lieferant_zahlung_info")
    .eq("lieferant_zahlung", "unklar")
    .order("booking_date", { ascending: false });
  return (data ?? []).map((t) => {
    const i = (t.lieferant_zahlung_info ?? {}) as { lieferant?: string; usd?: number | null; rechnung?: string | null; grund?: string };
    return { id: t.id as string, datum: String(t.booking_date).slice(0, 10), lieferant: i.lieferant ?? "", usd: i.usd ?? null, rechnung: i.rechnung ?? null, grund: i.grund ?? "" };
  });
}
