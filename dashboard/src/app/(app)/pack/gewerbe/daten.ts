// Daten der Gewerbekunden-Seite (server-only, OHNE Rechteprüfung – die macht page.tsx).
import { createServiceClient } from "@/lib/supabase/server";
import { ladeGewerbeMarkiert, ladeShopifyKunden } from "@/lib/gewerbe";
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
      gruende: r?.gruende ?? [],
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
