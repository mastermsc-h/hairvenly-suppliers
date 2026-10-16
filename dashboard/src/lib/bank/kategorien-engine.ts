// Kategorisierung + Steuer-Ledger-Abgleich — server-only, läuft mit service_role
// (Ingest-Endpoint ohne User-Session und Server Actions nach requireFeature-Check).
import { createServiceClient } from "@/lib/supabase/server";
import {
  gleicheSplits,
  kategorisiere,
  ledgerUpdate,
  sortRegeln,
  steuerSplitFuer,
  summiereSteuern,
  type KategorieRegel,
  type SteuerSplit,
} from "./kategorien";

type Sb = ReturnType<typeof createServiceClient>;

interface TxKatRow {
  id: string;
  booking_date: string;
  amount: number;
  counterparty_name: string | null;
  counterparty_iban: string | null;
  purpose: string | null;
  posting_text: string | null;
  match_status: string;
  kategorie: string | null;
  kategorie_quelle: string | null;
  kategorie_regel_id: string | null;
  steuer_split: SteuerSplit[] | null;
}

const KAT_FIELDS =
  "id, booking_date, amount, counterparty_name, counterparty_iban, purpose, posting_text, match_status, kategorie, kategorie_quelle, kategorie_regel_id, steuer_split";

async function inBatches<T>(items: T[], size: number, fn: (x: T) => PromiseLike<unknown>): Promise<void> {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

/** Supabase liefert max. 1000 Zeilen pro Abfrage → seitenweise laden. */
async function selectAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function loadRegeln(sb: Sb): Promise<KategorieRegel[]> {
  const { data, error } = await sb.from("bank_kategorie_regeln").select("id, prioritaet, feld, muster, richtung, kategorie");
  if (error) throw new Error(error.message);
  return sortRegeln((data ?? []) as KategorieRegel[]);
}

/**
 * Kategorisiert Umsätze neu. Manuell gesetzte Kategorien bleiben immer unberührt.
 * scope "neu": nur noch nicht kategorisierte + automatisch "unklar" gebliebene
 *              (z.B. erst nach dem Vorkasse-Abgleich als Kundenzahlung erkennbar).
 * scope "alle": nach Regeländerungen.
 */
export async function runKategorisierung(opts: { scope: "neu" | "alle"; sb?: Sb } = { scope: "neu" }): Promise<{ geprueft: number; geaendert: number }> {
  const sb = opts.sb ?? createServiceClient();
  const regeln = await loadRegeln(sb);
  const rows = await selectAll<TxKatRow>((from, to) => {
    let q = sb.from("bank_transactions").select(KAT_FIELDS).order("booking_date", { ascending: true }).range(from, to);
    q = opts.scope === "neu"
      ? q.or("kategorie.is.null,and(kategorie.eq.unklar,kategorie_quelle.eq.auto)")
      : q.or("kategorie_quelle.is.null,kategorie_quelle.neq.manuell");
    return q;
  });

  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  for (const tx of rows) {
    const r = kategorisiere({ ...tx, amount: Number(tx.amount) }, regeln);
    if (
      tx.kategorie === r.kategorie &&
      tx.kategorie_quelle === r.quelle &&
      tx.kategorie_regel_id === r.regel_id &&
      gleicheSplits(tx.steuer_split, r.steuer_split)
    ) continue;
    updates.push({
      id: tx.id,
      patch: { kategorie: r.kategorie, kategorie_quelle: r.quelle, kategorie_regel_id: r.regel_id, steuer_split: r.steuer_split },
    });
  }
  await inBatches(updates, 20, async (u) => {
    const { error } = await sb.from("bank_transactions").update(u.patch).eq("id", u.id);
    if (error) throw new Error(error.message);
  });
  if (rows.length > 0 || updates.length > 0) await syncSteuerLedger(sb);
  return { geprueft: rows.length, geaendert: updates.length };
}

/** Manuelle Kategorie für einzelne Umsätze (setzt Quelle "manuell"). */
export async function setKategorieManuell(ids: string[], kategorie: string, sb: Sb = createServiceClient()): Promise<void> {
  const { data, error } = await sb.from("bank_transactions").select("id, amount, booking_date, purpose, counterparty_name, counterparty_iban").in("id", ids);
  if (error) throw new Error(error.message);
  await inBatches(data ?? [], 20, async (tx) => {
    const split = steuerSplitFuer(kategorie, { ...tx, amount: Number(tx.amount) });
    const { error: e } = await sb
      .from("bank_transactions")
      .update({ kategorie, kategorie_quelle: "manuell", kategorie_regel_id: null, steuer_split: split })
      .eq("id", tx.id);
    if (e) throw new Error(e.message);
  });
  await syncSteuerLedger(sb);
}

/** Manuelle Kategorie zurücknehmen → wieder automatisch per Regeln. */
export async function resetKategorie(id: string, sb: Sb = createServiceClient()): Promise<void> {
  const { error } = await sb.from("bank_transactions").update({ kategorie: null, kategorie_quelle: null, kategorie_regel_id: null, steuer_split: [] }).eq("id", id);
  if (error) throw new Error(error.message);
  await runKategorisierung({ scope: "neu", sb });
}

interface PostenRow {
  id: string;
  art: string;
  zeitraum: string;
  jahr: number;
  richtung: "zahlung" | "erstattung";
  soll_betrag: number;
  ist_betrag: number;
  ist_quelle: "manuell" | "bank";
  bank_betrag: number | null;
}

/**
 * Überträgt die Bank-Summen je Steuerart+Zeitraum in den Steuer-Ledger.
 * Idempotent: rechnet immer aus allen Buchungen neu.
 * Invariante (ledgerUpdate): von Hand eingetragenes Ist wird nie überschrieben.
 */
export async function syncSteuerLedger(sb: Sb = createServiceClient()): Promise<{ aktualisiert: number; angelegt: number }> {
  const txs = (
    await selectAll<{ booking_date: string; steuer_split: SteuerSplit[] | null }>((from, to) =>
      sb.from("bank_transactions").select("booking_date, steuer_split").like("kategorie", "st_%").range(from, to)
    )
  ).filter((t) => Array.isArray(t.steuer_split) && t.steuer_split.length > 0);
  const summen = summiereSteuern(txs);
  const posten = await selectAll<PostenRow>((from, to) =>
    sb.from("steuer_posten").select("id, art, zeitraum, jahr, richtung, soll_betrag, ist_betrag, ist_quelle, bank_betrag").range(from, to)
  );
  const byKey = new Map(posten.map((p) => [`${p.art}|${p.zeitraum}`, p]));
  const seen = new Set<string>();
  let aktualisiert = 0;
  let angelegt = 0;

  await inBatches(summen, 10, async (s) => {
    const key = `${s.art}|${s.zeitraum}`;
    seen.add(key);
    const p = byKey.get(key);
    if (!p) {
      if (s.netto === 0) return;
      const { error } = await sb.from("steuer_posten").insert({
        art: s.art,
        zeitraum: s.zeitraum,
        jahr: s.jahr,
        richtung: s.netto > 0 ? "zahlung" : "erstattung",
        soll_betrag: 0,
        ist_betrag: Math.abs(s.netto),
        bezahlt_am: s.letzte_buchung,
        ist_quelle: "bank",
        bank_betrag: s.netto,
        bank_anzahl: s.anzahl,
        bank_letzte_buchung: s.letzte_buchung,
        notiz: "Aus Kontoumsätzen angelegt",
      });
      if (error) throw new Error(error.message);
      angelegt++;
      return;
    }
    const patch = {
      ...ledgerUpdate({ ...p, ist_betrag: Number(p.ist_betrag), soll_betrag: Number(p.soll_betrag) }, s),
      bank_betrag: s.netto,
      bank_anzahl: s.anzahl,
      bank_letzte_buchung: s.letzte_buchung,
    };
    const { error } = await sb.from("steuer_posten").update(patch).eq("id", p.id);
    if (error) throw new Error(error.message);
    aktualisiert++;
  });

  // Posten, zu denen es keine Bankbuchung (mehr) gibt — z.B. Kategorie wurde geändert
  const stale = posten.filter((p) => !seen.has(`${p.art}|${p.zeitraum}`) && (p.bank_betrag !== null || p.ist_quelle === "bank"));
  await inBatches(stale, 10, async (p) => {
    const patch: Record<string, unknown> = { bank_betrag: null, bank_anzahl: null, bank_letzte_buchung: null };
    if (p.ist_quelle === "bank") Object.assign(patch, { ist_betrag: 0, bezahlt_am: null, ist_quelle: "manuell" });
    const { error } = await sb.from("steuer_posten").update(patch).eq("id", p.id);
    if (error) throw new Error(error.message);
  });

  return { aktualisiert, angelegt };
}
