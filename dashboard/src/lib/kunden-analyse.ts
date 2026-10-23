// Kunden-Analyse: Shopify-Bestellungen → kunden_bestellungen (eine Zeile pro Bestellung).
// Bewusst ohne "@/"-Imports, damit scripts/sync-kunden-analyse.ts es direkt nutzen kann.
//
// Datenschutz: Klarnamen werden NICHT gespeichert. Die Namensherkunft ist eine
// statistische Schätzung (Claude Haiku) und wird im Cache nur unter einem
// SHA-256-Hash des normalisierten Namens abgelegt. Angezeigt wird nur aggregiert.

import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

// ── Herkunfts-Gruppen ─────────────────────────────────────────
export const HERKUNFT = {
  deutsch: "Deutsch",
  tuerkisch: "Türkisch",
  arabisch: "Arabisch",
  kurdisch: "Kurdisch",
  persisch: "Persisch / Afghanisch",
  polnisch: "Polnisch",
  russisch: "Russisch / Ukrainisch",
  balkan: "Balkan / Albanisch",
  rumaenisch: "Rumänisch / Bulgarisch",
  suedeuropa: "Südeuropäisch (IT/ES/PT/GR)",
  westeuropa: "West-/Nordeuropäisch, Englisch",
  afrikanisch: "Afrikanisch",
  asiatisch: "Asiatisch",
  sonstige: "Sonstige",
  unklar: "Nicht eindeutig",
} as const;
export type HerkunftKey = keyof typeof HERKUNFT;
const KEYS = Object.keys(HERKUNFT) as HerkunftKey[];

export function nameHash(vorname: string, nachname: string): string | null {
  const norm = (s: string) =>
    s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\s'-]/gu, " ").replace(/\s+/g, " ").trim();
  const v = norm(vorname);
  const n = norm(nachname);
  if (!v && !n) return null;
  return createHash("sha256").update(`${v}|${n}`).digest("hex");
}

const PROMPT = `Du klassifizierst Namen von Kundinnen/Kunden eines deutschen Online-Shops (Haarverlängerungen) nach der wahrscheinlichsten sprachlich-kulturellen Herkunft des NAMENS. Es geht um eine aggregierte Marktanalyse, nicht um Einzelpersonen.

Gruppen (genau einen Schlüssel wählen):
deutsch, tuerkisch, arabisch, kurdisch, persisch, polnisch, russisch, balkan, rumaenisch, suedeuropa, westeuropa, afrikanisch, asiatisch, sonstige, unklar

Regeln:
- Nachname wiegt schwerer als Vorname (Vornamen wie Sarah, Lara, Nina, Lea sind international).
- deutsch auch für typisch deutsche Nachnamen mit internationalem Vornamen (z. B. "Jessica Müller").
- tuerkisch: Yılmaz, Öztürk, Kaya, Demir, Şahin, Çelik, -oğlu; Vornamen wie Büşra, Merve, Kübra, Tuğba, Elif, Zeynep.
- arabisch: Al-/El-/Abu-, Mohammed, Hassan, Abdallah, Haddad; Vornamen wie Fatima, Aya, Rania, Hiba, Nour.
- kurdisch nur bei klar kurdischen Namen (z. B. Rojda, Berivan, Dilan + kurdischer Nachname), sonst tuerkisch/arabisch.
- persisch: iranisch/afghanisch (Ahmadi, Hosseini, Rezaei, Karimi; Vornamen wie Shirin, Parisa).
- polnisch: -ski/-ska, -wicz, -czyk, -ak; Agnieszka, Katarzyna, Małgorzata.
- russisch: russisch/ukrainisch/kasachisch (-ov/-ova, -ev/-eva, -enko, -in/-ina).
- balkan: -ić/-ic/-vić, albanisch (Krasniqi, Berisha, Hoxha), bosnisch, serbisch, kroatisch.
- rumaenisch: rumänisch/bulgarisch (-escu, -eanu).
- suedeuropa: italienisch, spanisch, portugiesisch, griechisch.
- westeuropa: englisch, französisch, niederländisch, skandinavisch.
- unklar: nur Initialen, Firmennamen, offensichtliche Fake-/Testnamen oder wirklich nicht einzuordnen.

Antworte ausschließlich über das Tool "klassifizierung" mit einem Eintrag pro Nummer.`;

/** Klassifiziert Namen per Claude Haiku. Rückgabe: Index → Schlüssel. Fehlende Indizes = nicht beantwortet. */
async function klassifiziereBatch(anthropic: Anthropic, namen: string[]): Promise<Map<number, HerkunftKey>> {
  const liste = namen.map((n, i) => `${i}: ${n}`).join("\n");
  const res = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 8000,
    system: PROMPT,
    tools: [
      {
        name: "klassifizierung",
        description: "Ergebnis der Klassifizierung",
        input_schema: {
          type: "object",
          properties: {
            e: {
              type: "array",
              items: {
                type: "object",
                properties: { i: { type: "integer" }, h: { type: "string", enum: KEYS } },
                required: ["i", "h"],
              },
            },
          },
          required: ["e"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "klassifizierung" },
    messages: [{ role: "user", content: liste }],
  });
  const out = new Map<number, HerkunftKey>();
  for (const block of res.content) {
    if (block.type !== "tool_use") continue;
    const e = (block.input as { e?: { i: number; h: string }[] }).e ?? [];
    for (const r of e) {
      if (Number.isInteger(r.i) && r.i >= 0 && r.i < namen.length && (KEYS as string[]).includes(r.h)) {
        out.set(r.i, r.h as HerkunftKey);
      }
    }
  }
  return out;
}

/**
 * Liefert für jeden Hash die Herkunft — erst aus dem Cache, Rest per LLM (und cacht ihn).
 * Hashes, die das LLM nicht beantwortet hat, fehlen im Ergebnis → nächster Lauf versucht es erneut.
 */
export async function herkunftFuerNamen(
  supabase: SupabaseClient,
  namen: Map<string, string>, // hash → "Vorname Nachname"
  opts: { deadline?: number; parallel?: number; batch?: number; log?: (s: string) => void } = {},
): Promise<Map<string, HerkunftKey>> {
  const result = new Map<string, HerkunftKey>();
  const hashes = [...namen.keys()];
  for (let i = 0; i < hashes.length; i += 200) {
    const { data, error } = await supabase
      .from("name_herkunft_cache")
      .select("name_hash, herkunft")
      .in("name_hash", hashes.slice(i, i + 200));
    if (error) throw error;
    for (const r of data ?? []) result.set(r.name_hash, r.herkunft as HerkunftKey);
  }

  const offen = hashes.filter((h) => !result.has(h));
  if (offen.length === 0 || !process.env.ANTHROPIC_API_KEY) return result;

  const anthropic = new Anthropic();
  const BATCH = opts.batch ?? 120;
  const batches: string[][] = [];
  for (let i = 0; i < offen.length; i += BATCH) batches.push(offen.slice(i, i + BATCH));

  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      if (opts.deadline && Date.now() > opts.deadline) return;
      const b = batches[next++];
      try {
        const map = await klassifiziereBatch(anthropic, b.map((h) => namen.get(h)!));
        const rows = [...map].map(([idx, h]) => ({ name_hash: b[idx], herkunft: h, methode: "llm" }));
        if (rows.length) {
          const { error } = await supabase.from("name_herkunft_cache").upsert(rows, { onConflict: "name_hash" });
          if (error) throw error;
          for (const r of rows) result.set(r.name_hash, r.herkunft);
        }
        opts.log?.(`  Namen klassifiziert: ${rows.length}/${b.length}`);
      } catch (e) {
        opts.log?.(`  Batch fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
      }
    }
  };
  await Promise.all(Array.from({ length: opts.parallel ?? 3 }, worker));
  return result;
}

// ── Shopify ───────────────────────────────────────────────────
interface Adresse {
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  city: string | null;
  zip: string | null;
  countryCodeV2: string | null;
}
interface OrderNode {
  legacyResourceId: string;
  name: string;
  createdAt: string;
  cancelledAt: string | null;
  test: boolean;
  sourceName: string | null;
  tags: string[];
  currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } } | null;
  customer: { legacyResourceId: string; firstName: string | null; lastName: string | null; tags: string[] } | null;
  billingAddress: Adresse | null;
  shippingAddress: Adresse | null;
}

const ORDERS_QUERY = `query($c: String, $q: String) {
  orders(first: 250, after: $c, query: $q, sortKey: UPDATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      legacyResourceId name createdAt cancelledAt test sourceName tags
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      customer { legacyResourceId firstName lastName tags }
      billingAddress { firstName lastName company city zip countryCodeV2 }
      shippingAddress { firstName lastName company city zip countryCodeV2 }
    }
  }
}`;

async function shopify<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const url = `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2025-01/graphql.json`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN ?? "" },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length) {
      if (json.errors.some((e) => /throttled/i.test(e.message))) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      throw new Error(json.errors.map((e) => e.message).join("; "));
    }
    return json.data as T;
  }
  throw new Error("Shopify GraphQL: zu viele Fehlversuche");
}

const istB2B = (tags: string[] | undefined) => (tags ?? []).some((t) => t.trim().toLowerCase() === "b2b");

function nameVon(o: OrderNode): { v: string; n: string } {
  for (const q of [o.customer, o.billingAddress, o.shippingAddress]) {
    const v = q?.firstName?.trim() ?? "";
    const n = q?.lastName?.trim() ?? "";
    if (v || n) return { v, n };
  }
  return { v: "", n: "" };
}

/**
 * Synct Bestellungen (nach updated_at) in kunden_bestellungen inkl. Namensherkunft.
 * sinceIso = null → alles. Stoppt sauber an der Deadline (Cron: 60s-Limit).
 */
export async function syncKundenBestellungen(
  supabase: SupabaseClient,
  opts: { sinceIso: string | null; deadline?: number; log?: (s: string) => void },
): Promise<{ orders: number; ohneHerkunft: number; fertig: boolean }> {
  const q = opts.sinceIso ? `updated_at:>='${opts.sinceIso}'` : null;
  let cursor: string | null = null;
  let orders = 0;
  let ohneHerkunft = 0;
  let fertig = false;

  while (true) {
    if (opts.deadline && Date.now() > opts.deadline) break;
    const data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: OrderNode[] } } =
      await shopify(ORDERS_QUERY, { c: cursor, q });
    const nodes = data.orders.nodes.filter((o) => !o.test);

    const namen = new Map<string, string>();
    const hashVon = new Map<string, string | null>();
    for (const o of nodes) {
      const { v, n } = nameVon(o);
      const h = nameHash(v, n);
      hashVon.set(o.legacyResourceId, h);
      if (h) namen.set(h, `${v} ${n}`.trim());
    }
    const herkunft = await herkunftFuerNamen(supabase, namen, { deadline: opts.deadline, log: opts.log });

    const rows = nodes.map((o) => {
      const adr = o.shippingAddress ?? o.billingAddress;
      const h = hashVon.get(o.legacyResourceId);
      const hk = h ? (herkunft.get(h) ?? null) : "unklar";
      if (!hk) ohneHerkunft++;
      return {
        order_id: Number(o.legacyResourceId),
        order_name: o.name,
        created_at: o.createdAt,
        umsatz_eur: Number(o.currentTotalPriceSet?.shopMoney.amount ?? 0),
        waehrung: o.currentTotalPriceSet?.shopMoney.currencyCode ?? null,
        land: adr?.countryCodeV2 ?? null,
        stadt: adr?.city?.trim() || null,
        plz: adr?.zip?.trim() || null,
        customer_id: o.customer ? Number(o.customer.legacyResourceId) : null,
        kanal: o.sourceName,
        gewerbe: istB2B(o.customer?.tags) || istB2B(o.tags),
        firma: !!(o.billingAddress?.company?.trim() || o.shippingAddress?.company?.trim()),
        storniert: !!o.cancelledAt,
        herkunft: hk,
        synced_at: new Date().toISOString(),
      };
    });
    if (rows.length) {
      const { error } = await supabase.from("kunden_bestellungen").upsert(rows, { onConflict: "order_id" });
      if (error) throw error;
    }
    orders += rows.length;
    opts.log?.(`Bestellungen gesynct: ${orders}`);

    if (!data.orders.pageInfo.hasNextPage) {
      fertig = true;
      break;
    }
    cursor = data.orders.pageInfo.endCursor;
  }
  return { orders, ohneHerkunft, fertig };
}

/** Cron: letzte 3 Tage nach updated_at (neue Bestellungen, Stornos, Erstattungen, B2B-Tags). */
export async function cronKundenSync(supabase: SupabaseClient, deadline: number) {
  try {
    const since = new Date(Date.now() - 3 * 86400_000).toISOString();
    return await syncKundenBestellungen(supabase, { sinceIso: since, deadline });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
