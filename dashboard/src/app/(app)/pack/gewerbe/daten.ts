// Daten der Gewerbekunden-Seite (server-only, OHNE Rechteprüfung – die macht page.tsx).
import { createServiceClient } from "@/lib/supabase/server";
import { firmenAusBestellungen, ladeGewerbeMarkiert, ladeShopifyKunden } from "@/lib/gewerbe";
import type { GewerbeZeile } from "./gewerbe-liste";
type Roh = {
  customer_id: number; markiert: boolean; bestellungen: number; umsatz: number; bestellungen12: number; umsatz12: number;
  erste: string | null; letzte: string | null; firma: boolean; punkte: number; gruende: string[]; stadt: string | null; plz: string | null; land: string | null;
};

const berlin = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" });

export async function ladeGewerbeZeilen(): Promise<GewerbeZeile[]> {
  const markiert = await ladeGewerbeMarkiert();
  const ids = markiert.map((k) => k.id);
  const { data, error } = await createServiceClient().rpc("gewerbe_kunden_liste", { p_ids: ids, p_min_punkte: 3 });
  if (error) throw new Error(error.message);
  const roh = (data ?? []) as Roh[];
  const proId = new Map(roh.map((r) => [Number(r.customer_id), r]));
  const verdacht = roh.filter((r) => !r.markiert);
  const [shop, notizRes] = await Promise.all([
    ladeShopifyKunden(verdacht.map((r) => Number(r.customer_id))),
    createServiceClient().from("gewerbe_notizen").select("customer_id, notiz, geaendert_am, profiles(display_name, username)"),
  ]);
  // Firma steht nur in einer älteren Bestellung → dort nachsehen
  const ohneFirma = verdacht.filter((r) => r.firma && !shop.get(Number(r.customer_id))?.firma).map((r) => Number(r.customer_id));
  let aeltere = new Map<number, string>();
  if (ohneFirma.length) {
    const { data: best } = await createServiceClient().from("kunden_bestellungen").select("customer_id, order_id").eq("firma", true).in("customer_id", ohneFirma).order("created_at", { ascending: false });
    // alle Firmen-Bestellungen dieser Kunden (neueste zuerst) – die erste mit Firmennamen gewinnt
    const liste = ((best ?? []) as Array<{ customer_id: number; order_id: number }>).slice(0, 400).map((b) => ({ kunde: Number(b.customer_id), bestellung: Number(b.order_id) }));
    aeltere = await firmenAusBestellungen(liste).catch((e) => { console.warn("[gewerbe] Firmen aus Bestellungen:", e instanceof Error ? e.message : e); return new Map<number, string>(); });
  }
  for (const [id, firma] of aeltere) { const k = shop.get(id); if (k) shop.set(id, { ...k, firma }); }
  type NotizRoh = { customer_id: number; notiz: string; geaendert_am: string; profiles: { display_name: string | null; username: string | null } | null };
  const notizen = new Map(((notizRes.data ?? []) as unknown as NotizRoh[]).map((n) => [Number(n.customer_id), n]));
  const heute = Date.parse(`${berlin.format(new Date())}T12:00:00Z`);
  const tage = (iso: string | null) => (iso ? Math.round((heute - Date.parse(`${berlin.format(new Date(iso))}T12:00:00Z`)) / 86_400_000) : null);

  const zeile = (id: number, k: { name: string; firma: string | null; email: string | null; ort: string | null } | undefined, r: Roh | undefined, istMarkiert: boolean): GewerbeZeile => {
    const t = tage(r?.letzte ?? null);
    const ortRoh = r?.stadt?.trim() || k?.ort?.replace(/^\d+\s*/, "").trim() || null;
    return {
      id,
      name: k?.name ?? "Unbekannt",
      firma: k?.firma ?? null,
      email: k?.email ?? null,
      ort: ortRoh ? ortRoh.replace(/\s+/g, " ").replace(/^./, (c) => c.toUpperCase()) : null,
      plz: r?.plz ?? null,
      land: r?.land ?? null,
      markiert: istMarkiert,
      bestellungen: r?.bestellungen ?? 0,
      umsatz: Number(r?.umsatz ?? 0),
      bestellungen12: r?.bestellungen12 ?? 0,
      umsatz12: Number(r?.umsatz12 ?? 0),
      erste: r?.erste ?? null,
      letzte: r?.letzte ?? null,
      tageSeit: t,
      status: t == null ? "nie" : t <= 90 ? "aktiv" : t <= 365 ? "inaktiv" : "tot",
      punkte: r?.punkte ?? 0,
      // „Firma in der Adresse“ → mit Firmennamen, wenn Shopify ihn kennt
      gruende: (r?.gruende ?? []).map((g) => (g === "Firma in der Adresse" && k?.firma ? `Firma: ${k.firma}` : g)),
      notiz: notizen.get(id)?.notiz ?? "",
      notizAm: notizen.get(id)?.geaendert_am ?? null,
      notizVon: notizen.get(id)?.profiles?.display_name ?? notizen.get(id)?.profiles?.username ?? null,
    };
  };

  const zeilen: GewerbeZeile[] = [
    ...markiert.map((k) => zeile(k.id, k, proId.get(k.id), true)),
    ...verdacht.map((r) => zeile(Number(r.customer_id), shop.get(Number(r.customer_id)), r, false)),
  ];
  return zeilen;
}
