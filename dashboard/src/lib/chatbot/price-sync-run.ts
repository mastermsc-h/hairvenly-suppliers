import type { SupabaseClient } from "@supabase/supabase-js";
import { shopifyGraphQL } from "@/lib/shopify";
import {
  derivePrices, planPriceUpdates, findStaleFaqPrices,
  type ShopifyProductLite, type CurrentPriceRow, type PlanRow,
} from "./price-sync";

export interface PriceSyncReport {
  ran_at: string;
  dry_run: boolean;
  products: number;
  rows: PlanRow[];
  updated: number;
  check: number;
  stale_faqs: { id: string; question: string; prices: string[] }[];
  /** Trainings-Beispiele (good_answer), die alte Preise nennen — der Bot kopiert diese. */
  stale_training: { id: string; question: string; prices: string[] }[];
}

const QUERY = `query($after: String) {
  products(first: 250, after: $after, query: "status:active") {
    pageInfo { hasNextPage endCursor }
    nodes { title variants(first: 20) { nodes { title price } } }
  }
}`;

type Page = { products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { title: string; variants: { nodes: { title: string; price: string }[] } }[] } };

async function fetchActiveProducts(): Promise<ShopifyProductLite[]> {
  const out: ShopifyProductLite[] = [];
  let after: string | null = null;
  for (let i = 0; i < 40; i++) {
    const res: { data?: Page } = await shopifyGraphQL<Page>(QUERY, { after }, { allowPartialErrors: true });
    const p: Page["products"] | undefined = res.data?.products;
    if (!p) throw new Error("Shopify: keine Produktdaten");
    for (const n of p.nodes) out.push({ title: n.title, variants: n.variants.nodes });
    if (!p.pageInfo.hasNextPage) break;
    after = p.pageInfo.endCursor;
  }
  return out;
}

/**
 * Gleicht chatbot_prices mit Shopify ab. Schreibt nur Zeilen mit Status
 * „update" (siehe planPriceUpdates — Sicherheitsgrenzen). Der Report wird
 * immer in chatbot_settings gespeichert, auch beim Probelauf.
 */
export async function runPriceSync(svc: SupabaseClient, opts: { dryRun?: boolean } = {}): Promise<PriceSyncReport> {
  const products = await fetchActiveProducts();
  // Plausibilitäts-Netz: halber/leerer Shopify-Abruf darf nichts verändern
  if (products.length < 100) throw new Error(`Shopify lieferte nur ${products.length} aktive Produkte — Abbruch ohne Änderungen`);

  const { data: cur, error } = await svc
    .from("chatbot_prices")
    .select("method, supplier_line, length_cm, gram_label, price_eur, active");
  if (error) throw new Error(error.message);
  const current = (cur ?? []).map((r) => ({ ...r, price_eur: Number(r.price_eur) })) as CurrentPriceRow[];

  const rows = planPriceUpdates(current, derivePrices(products));
  const updates = rows.filter((r) => r.status === "update");

  if (!opts.dryRun) {
    for (const u of updates) {
      let q = svc.from("chatbot_prices")
        .update({ price_eur: u.new_price, updated_at: new Date().toISOString() })
        .eq("method", u.method).eq("supplier_line", u.supplier_line).eq("active", true);
      q = u.length_cm === null ? q.is("length_cm", null) : q.eq("length_cm", u.length_cm);
      q = u.gram_label === null ? q.is("gram_label", null) : q.eq("gram_label", u.gram_label);
      const { error: e } = await q;
      if (e) throw new Error(`Update ${u.method}/${u.length_cm}: ${e.message}`);
    }
  }

  // FAQ-Antworten mit alten Preisen → nur melden (Texte nicht automatisch umschreiben)
  const { data: faqs } = await svc.from("chatbot_faq").select("id, question, answer").eq("active", true);
  const oldPrices = [...new Set(updates.map((u) => u.old_price).filter((p): p is number => p !== null))];
  const prevReport = await svc.from("chatbot_settings").select("prices_sync_report").eq("id", 1).maybeSingle();
  // alte Preise früherer Läufe weiter prüfen, bis die FAQ korrigiert ist
  const prevOld = ((prevReport.data?.prices_sync_report as { old_prices?: number[] } | null)?.old_prices) ?? [];
  const allOld = [...new Set([...oldPrices, ...prevOld])];
  const stale_faqs = findStaleFaqPrices(faqs ?? [], allOld);
  const { data: training } = await svc.from("chatbot_training").select("id, user_message, good_answer").eq("active", true);
  const stale_training = findStaleFaqPrices(
    (training ?? []).map((t) => ({ id: t.id as string, question: String(t.user_message ?? "").slice(0, 120), answer: String(t.good_answer ?? "") })),
    allOld,
  );

  const report: PriceSyncReport & { old_prices: number[] } = {
    ran_at: new Date().toISOString(),
    dry_run: !!opts.dryRun,
    products: products.length,
    rows,
    updated: opts.dryRun ? 0 : updates.length,
    check: rows.filter((r) => r.status === "check").length,
    stale_faqs,
    stale_training,
    old_prices: allOld,
  };
  await svc.from("chatbot_settings").update({
    prices_synced_at: report.ran_at,
    prices_sync_report: report,
  }).eq("id", 1);
  return report;
}
