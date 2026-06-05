"use server";

import * as XLSX from "xlsx";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";

export type RowStatus = "matched" | "color_unknown" | "method_unknown" | "length_unknown" | "error";

export interface ParsedRow {
  raw_method: string;
  raw_length: string;
  raw_color: string;
  grams: number;
  // Resolved (if matched)
  method_id?: string;
  method_name?: string;
  length_id?: string;
  length_value?: string;
  color_id?: string;
  color_name?: string;
  status: RowStatus;
  // FIFO allocation suggestion: which order(s) consume this position
  allocations?: Allocation[];
  // Excess after allocating to all matching open positions → goes into "lose Ware"
  excess_grams?: number;
}

export interface Allocation {
  order_id: string;
  order_label: string;
  order_item_id: string;
  ordered_g: number;
  already_received_g: number;
  open_g: number;
  allocate_g: number;
}

export interface AnalyzeResult {
  ok: boolean;
  error?: string;
  rows?: ParsedRow[];
  total_positions: number;
  matched: number;
  total_grams: number;
  matched_grams: number;
  supplier_id?: string;
}

function norm(s: string | null): string {
  return String(s || "")
    .toUpperCase()
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normColorAggressive(s: string | null): string {
  return String(s || "")
    .toUpperCase()
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\bNATUREL\b/g, "NATURAL")
    .replace(/\s+NO\s*$/g, "")
    .replace(/\s*NO\s*BOYALI\s*/g, "")
    .replace(/BLONDE/g, "BLOND")
    .replace(/BALYAGE/g, "BALAYAGE")
    .replace(/PEARLY/g, "PEARL")
    .replace(/\s+US\s+WELLIGE.*$/g, "")
    .replace(/\s+K[ÜU]HLES\s+BLOND.*$/g, "")
    .replace(/\s+HASELNUSSBRAUNE?.*$/g, "")
    .replace(/\s+SCHWARZBRAUNE?.*$/g, "")
    .replace(/[\/\-]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

interface CatalogEntry {
  method_id: string;
  method_name: string;
  method_aliases: string[];
  length_id: string;
  length_value: string;
  length_aliases: string[];
  color_id: string | null;
  color_name: string | null;
  color_aliases: string[];
}

/**
 * Analysiert einen Lieferschein (xlsx) gegen den Katalog des angegebenen
 * Lieferanten + die offenen Bestellungen. Schreibt NICHTS — gibt einen Plan
 * zurück, den der User im UI prüfen kann.
 */
export async function analyzeLieferschein(formData: FormData): Promise<AnalyzeResult> {
  try {
    const profile = await requireProfile();
    if (!profile.is_admin) return { ok: false, error: "Nur Admins", total_positions: 0, matched: 0, total_grams: 0, matched_grams: 0 };

    const supplier_id = String(formData.get("supplier_id") || "");
    const file = formData.get("file") as File | null;
    if (!supplier_id) return { ok: false, error: "Lieferant fehlt", total_positions: 0, matched: 0, total_grams: 0, matched_grams: 0 };
    if (!file) return { ok: false, error: "Datei fehlt", total_positions: 0, matched: 0, total_grams: 0, matched_grams: 0 };

    const supabase = await createClient();

    // Load catalog with aliases
    const { data: catData, error: catErr } = await supabase
      .from("product_methods")
      .select(`
        id, name, name_supplier_aliases,
        product_lengths (
          id, value, name_supplier_aliases,
          product_colors ( id, name_hairvenly, name_supplier_aliases )
        )
      `)
      .eq("supplier_id", supplier_id);
    if (catErr) return { ok: false, error: catErr.message, total_positions: 0, matched: 0, total_grams: 0, matched_grams: 0 };

    type RawMethod = {
      id: string; name: string; name_supplier_aliases: string[] | null;
      product_lengths: {
        id: string; value: string; name_supplier_aliases: string[] | null;
        product_colors: { id: string; name_hairvenly: string; name_supplier_aliases: string[] | null }[];
      }[];
    };
    const catalog: CatalogEntry[] = [];
    for (const m of (catData ?? []) as RawMethod[]) {
      for (const l of m.product_lengths ?? []) {
        for (const c of l.product_colors ?? []) {
          catalog.push({
            method_id: m.id, method_name: m.name, method_aliases: m.name_supplier_aliases ?? [],
            length_id: l.id, length_value: l.value, length_aliases: l.name_supplier_aliases ?? [],
            color_id: c.id, color_name: c.name_hairvenly, color_aliases: c.name_supplier_aliases ?? [],
          });
        }
        // Also include length-row without colors so length match works
        if ((l.product_colors ?? []).length === 0) {
          catalog.push({
            method_id: m.id, method_name: m.name, method_aliases: m.name_supplier_aliases ?? [],
            length_id: l.id, length_value: l.value, length_aliases: l.name_supplier_aliases ?? [],
            color_id: null, color_name: null, color_aliases: [],
          });
        }
      }
    }

    // Build lookup maps
    const methodLookup = new Map<string, { id: string; name: string }>();
    for (const e of catalog) {
      methodLookup.set(norm(e.method_name), { id: e.method_id, name: e.method_name });
      for (const a of e.method_aliases) methodLookup.set(norm(a), { id: e.method_id, name: e.method_name });
    }
    // Length lookup is per method (same value can exist under multiple methods)
    const lengthLookup = new Map<string, { id: string; value: string }>(); // key: method_id + "|" + normalized
    for (const e of catalog) {
      const mk = (txt: string) => `${e.method_id}|${norm(txt)}`;
      lengthLookup.set(mk(e.length_value), { id: e.length_id, value: e.length_value });
      for (const a of e.length_aliases) lengthLookup.set(mk(a), { id: e.length_id, value: e.length_value });
    }
    // Color lookup: per (method_id, length_id, normalized color)
    const colorLookup = new Map<string, { id: string; name: string }>();
    for (const e of catalog) {
      if (!e.color_id || !e.color_name) continue;
      const mk = (txt: string) => `${e.method_id}|${e.length_id}|${normColorAggressive(txt)}`;
      colorLookup.set(mk(e.color_name), { id: e.color_id, name: e.color_name });
      for (const a of e.color_aliases) colorLookup.set(mk(a), { id: e.color_id, name: e.color_name });
    }

    // Parse xlsx — xlsx erwartet Uint8Array bei type:"array", nicht raw ArrayBuffer
    const arrayBuf = await file.arrayBuffer();
    const u8 = new Uint8Array(arrayBuf);
    const wb = XLSX.read(u8, { type: "array" });
    if (!wb.SheetNames || wb.SheetNames.length === 0) {
      return { ok: false, error: "Excel-Datei enthält keine Tabellenblätter", total_positions: 0, matched: 0, total_grams: 0, matched_grams: 0 };
    }
    const ws = wb.Sheets[wb.SheetNames[0]];
    const sheetRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, blankrows: false });

    const parsed: ParsedRow[] = [];
    let totalG = 0, matchedG = 0;

    for (const r of sheetRows) {
      if (!Array.isArray(r) || r.length < 4) continue;
      const rawMethod = String(r[0] ?? "").trim();
      const rawLength = String(r[1] ?? "").trim();
      const rawColor = String(r[2] ?? "").trim().replace(/[\r\n]+/g, " ");
      const totalGramsCell = Number(r[5]);
      if (!rawMethod || rawMethod.includes("品名") || !Number.isFinite(totalGramsCell)) continue;
      if (!rawColor || rawColor.includes("颜色")) continue;
      totalG += totalGramsCell;

      const row: ParsedRow = { raw_method: rawMethod, raw_length: rawLength, raw_color: rawColor, grams: totalGramsCell, status: "error" };

      // Resolve method
      const methodHit = methodLookup.get(norm(rawMethod))
        ?? (() => {
          // try individual tokens for compound chinese+turkish strings
          for (const tok of norm(rawMethod).split(" ")) {
            const h = methodLookup.get(tok);
            if (h) return h;
          }
          return null;
        })();
      if (!methodHit) { row.status = "method_unknown"; parsed.push(row); continue; }
      row.method_id = methodHit.id;
      row.method_name = methodHit.name;

      // Resolve length
      const lengthHit = lengthLookup.get(`${methodHit.id}|${norm(rawLength)}`);
      if (!lengthHit) { row.status = "length_unknown"; parsed.push(row); continue; }
      row.length_id = lengthHit.id;
      row.length_value = lengthHit.value;

      // Resolve color
      const colorHit = colorLookup.get(`${methodHit.id}|${lengthHit.id}|${normColorAggressive(rawColor)}`);
      if (!colorHit) { row.status = "color_unknown"; parsed.push(row); continue; }
      row.color_id = colorHit.id;
      row.color_name = colorHit.name;
      row.status = "matched";
      matchedG += totalGramsCell;
      parsed.push(row);
    }

    // FIFO allocation against open order_items for this supplier
    // 1) Load all open orders for the supplier
    const { data: openOrders } = await supabase
      .from("orders")
      .select("id, label, created_at, status")
      .eq("supplier_id", supplier_id)
      .not("status", "in", '("stocked","cancelled","delivered")')
      .order("created_at", { ascending: true });

    if (openOrders && openOrders.length > 0) {
      const orderIds = openOrders.map((o) => o.id);
      const { data: oiData } = await supabase
        .from("order_items")
        .select("id, order_id, color_id, method_name, length_value, quantity, pushed_to_shopify_at, shipment_id")
        .in("order_id", orderIds);

      type OI = {
        id: string; order_id: string; color_id: string | null;
        method_name: string; length_value: string; quantity: number;
        pushed_to_shopify_at: string | null; shipment_id: string | null;
      };
      const oiByColor = new Map<string, OI[]>();
      for (const oi of (oiData ?? []) as OI[]) {
        if (!oi.color_id) continue;
        // Skip items that are already in a shipment or pushed
        if (oi.shipment_id) continue;
        const arr = oiByColor.get(oi.color_id) ?? [];
        arr.push(oi);
        oiByColor.set(oi.color_id, arr);
      }
      const orderById = new Map(openOrders.map((o) => [o.id, o]));

      // Sort each per-color bucket by order created_at (FIFO)
      for (const arr of oiByColor.values()) {
        arr.sort((a, b) => {
          const oa = orderById.get(a.order_id);
          const ob = orderById.get(b.order_id);
          return new Date(oa?.created_at ?? 0).getTime() - new Date(ob?.created_at ?? 0).getTime();
        });
      }

      // Allocate per parsed row (FIFO with exact qty match on bucket)
      // Track allocated qty per order_item to allow multiple lieferschein rows
      // to share an order_item (rare but possible when supplier splits).
      const allocatedById = new Map<string, number>();

      for (const row of parsed) {
        if (row.status !== "matched" || !row.color_id) continue;
        const bucket = oiByColor.get(row.color_id) ?? [];
        let remaining = row.grams;
        const allocs: Allocation[] = [];
        for (const oi of bucket) {
          if (remaining <= 0) break;
          const ordered = oi.quantity;
          const already = allocatedById.get(oi.id) ?? 0;
          const open = ordered - already;
          if (open <= 0) continue;
          const take = Math.min(open, remaining);
          allocs.push({
            order_id: oi.order_id,
            order_label: orderById.get(oi.order_id)?.label ?? "?",
            order_item_id: oi.id,
            ordered_g: ordered,
            already_received_g: already,
            open_g: open,
            allocate_g: take,
          });
          allocatedById.set(oi.id, already + take);
          remaining -= take;
        }
        row.allocations = allocs;
        row.excess_grams = remaining > 0 ? remaining : 0;
      }
    }

    return {
      ok: true,
      rows: parsed,
      total_positions: parsed.length,
      matched: parsed.filter((r) => r.status === "matched").length,
      total_grams: totalG,
      matched_grams: matchedG,
      supplier_id,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), total_positions: 0, matched: 0, total_grams: 0, matched_grams: 0 };
  }
}

/**
 * Commit-Step: legt aus dem Analyse-Plan einen Wareneingang an, mit Items.
 * Für gematchte Positionen mit Allokationen werden optional Teillieferungen
 * (order_shipments) in den jeweiligen Bestellungen erzeugt, mit Verweis
 * auf die inbound_delivery_id.
 */
export async function commitLieferschein(payload: {
  supplier_id: string;
  label: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  eta: string | null;
  shipped_at: string | null;
  arrived_at: string | null;
  notes: string | null;
  /**
   * "full"           — Wareneingang + Items + Teillieferung(en) in allen
   *                    betroffenen Bestellungen
   * "shipment_only"  — nur 1 Teillieferung in der einzigen betroffenen
   *                    Bestellung (kein Wareneingang). Nur erlaubt wenn
   *                    genau 1 Bestellung gematcht und kein Überschuss.
   */
  mode: "full" | "shipment_only";
  rows: ParsedRow[];
}): Promise<{ ok: boolean; error?: string; inbound_delivery_id?: string; shipment_id?: string; order_id?: string; shipments_created?: number }> {
  try {
    const profile = await requireProfile();
    if (!profile.is_admin) return { ok: false, error: "Nur Admins" };
    const supabase = await createClient();

    // Group allocations by order
    const byOrder = new Map<string, { items: string[]; allocG: number }>();
    for (const r of payload.rows) {
      if (r.status !== "matched") continue;
      for (const a of r.allocations ?? []) {
        const cur = byOrder.get(a.order_id) ?? { items: [], allocG: 0 };
        cur.items.push(a.order_item_id);
        cur.allocG += a.allocate_g;
        byOrder.set(a.order_id, cur);
      }
    }

    // ────────────────────────────────────────────────────────────
    // Mode: shipment_only — nur Teillieferung anlegen, kein Wareneingang
    // ────────────────────────────────────────────────────────────
    if (payload.mode === "shipment_only") {
      if (byOrder.size !== 1) {
        return { ok: false, error: "Modus 'Nur Teillieferung' erfordert genau 1 betroffene Bestellung" };
      }
      const [[orderId, info]] = [...byOrder.entries()];

      // Überschuss aus dem Lieferschein als sichtbarer Hinweis in den Notes
      // festhalten — damit der User später die Differenz zwischen Bestellung
      // und tatsächlicher Lieferung sieht, auch wenn kein Wareneingang
      // angelegt wurde.
      const excessRows = payload.rows.filter(
        (r) => r.status === "matched" && (r.excess_grams ?? 0) > 0,
      );
      let notesField = payload.notes;
      if (excessRows.length > 0) {
        const totalExcess = excessRows.reduce((s, r) => s + (r.excess_grams ?? 0), 0);
        const lines = excessRows.map(
          (r) => `  • ${r.method_name} ${r.length_value} #${r.color_name}: bestellt vs. geliefert → +${r.excess_grams} g`,
        );
        const excessBlock = [
          `⚠ Mehrlieferung gegenüber Bestellpositionen: +${totalExcess} g insgesamt`,
          ...lines,
          "(Mehrlieferung als delivered_quantity erfasst → wird beim Shopify-Push mit eingepflegt.)",
        ].join("\n");
        notesField = notesField ? `${notesField}\n\n${excessBlock}` : excessBlock;
      }

      const { data: shipment, error: shErr } = await supabase
        .from("order_shipments")
        .insert({
          order_id: orderId,
          label: payload.label,
          tracking_number: payload.tracking_number,
          tracking_url: payload.tracking_url,
          eta: payload.eta,
          shipped_at: payload.shipped_at,
          arrived_at: payload.arrived_at,
          notes: notesField,
          inbound_delivery_id: null,
        })
        .select("id")
        .single();
      if (shErr || !shipment) return { ok: false, error: shErr?.message ?? "Teillieferung konnte nicht angelegt werden" };

      // Zuerst alle Items dem Shipment zuordnen
      await supabase.from("order_items").update({ shipment_id: shipment.id }).in("id", info.items);

      // Pro betroffener Bestellposition die tatsächliche Liefermenge setzen
      // (Ordered + Excess). Bei Mehrlieferung landet der Überschuss damit
      // auch im Shopify-Push, ist aber sauber als Differenz erkennbar.
      for (const r of payload.rows) {
        if (r.status !== "matched") continue;
        for (const a of r.allocations ?? []) {
          if (a.order_id !== orderId) continue;
          // shipment_only-Modus → Excess der ganzen Lieferschein-Zeile
          // gehört zu DIESER Bestellung (es gibt keine andere allocation
          // weil byOrder.size === 1).
          const delivered = a.allocate_g + (r.excess_grams ?? 0);
          await supabase
            .from("order_items")
            .update({ delivered_quantity: delivered })
            .eq("id", a.order_item_id);
        }
      }

      revalidatePath(`/orders/${orderId}`);
      return { ok: true, shipment_id: shipment.id, order_id: orderId, shipments_created: 1 };
    }

    // ────────────────────────────────────────────────────────────
    // Mode: full — Wareneingang + Items + (N Teillieferungen)
    // ────────────────────────────────────────────────────────────
    const { data: del, error: delErr } = await supabase
      .from("inbound_deliveries")
      .insert({
        supplier_id: payload.supplier_id,
        label: payload.label,
        tracking_number: payload.tracking_number,
        tracking_url: payload.tracking_url,
        eta: payload.eta,
        shipped_at: payload.shipped_at,
        arrived_at: payload.arrived_at,
        notes: payload.notes,
      })
      .select("id")
      .single();
    if (delErr || !del) return { ok: false, error: delErr?.message ?? "Wareneingang konnte nicht angelegt werden" };

    const items = payload.rows
      .filter((r) => r.status === "matched" && r.color_id && r.grams > 0)
      .map((r) => ({
        inbound_delivery_id: del.id,
        color_id: r.color_id!,
        method_name: r.method_name!,
        length_value: r.length_value!,
        color_name: r.color_name!,
        quantity: Math.round(r.grams),
        unit: "g",
      }));
    if (items.length > 0) {
      const { error: itErr } = await supabase.from("inbound_delivery_items").insert(items);
      if (itErr) return { ok: false, error: `Items: ${itErr.message}`, inbound_delivery_id: del.id };
    }

    let shipmentsCreated = 0;
    for (const [orderId, info] of byOrder.entries()) {
      const { data: shipment, error: shErr } = await supabase
        .from("order_shipments")
        .insert({
          order_id: orderId,
          label: payload.label ? `Aus ${payload.label}` : `Aus Wareneingang`,
          tracking_number: payload.tracking_number,
          tracking_url: payload.tracking_url,
          eta: payload.eta,
          shipped_at: payload.shipped_at,
          arrived_at: payload.arrived_at,
          notes: null,
          inbound_delivery_id: del.id,
        })
        .select("id")
        .single();
      if (shErr || !shipment) continue;
      await supabase.from("order_items").update({ shipment_id: shipment.id }).in("id", info.items);
      shipmentsCreated++;
    }

    revalidatePath("/inbound-deliveries");
    revalidatePath(`/inbound-deliveries/${del.id}`);
    return { ok: true, inbound_delivery_id: del.id, shipments_created: shipmentsCreated };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
