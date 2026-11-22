import { redirect } from "next/navigation";
import { requireFeature } from "@/lib/auth";
import { ladeSteuerKasse } from "@/lib/cockpit/daten";
import { createServiceClient } from "@/lib/supabase/server";
import Steuertipps from "./steuertipps";

export const dynamic = "force-dynamic";

export type SteuertippsBasis = {
  jahr: number;
  /** Hochgerechneter Jahresgewinn laut Finanzübersicht (null = noch keine Monatsdaten). */
  gewinnJahr: number | null;
  gewinnQuelle: string;
  hebesatz: number;
  freibetrag: number;
  mitarbeiter: number;
  /** Shop-Umsatz Nov/Dez des Vorjahres (für die Retouren-Rückstellung). */
  shopNovVorjahr: number | null;
  shopDezVorjahr: number | null;
};

export default async function SteuertippsPage() {
  const profile = await requireFeature("finances");
  if (profile.role === "supplier") redirect("/");
  const sb = createServiceClient();
  const jahr = Number(new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" }).slice(0, 4));

  const [kasse, monat, staff, shop] = await Promise.all([
    ladeSteuerKasse().catch(() => null),
    sb.from("finanz_monatsdaten").select("daten").eq("jahr", jahr).order("monat", { ascending: false }).limit(1).maybeSingle(),
    sb.from("staff_members").select("id", { count: "exact", head: true }).eq("active", true),
    sb.from("shopify_umsatz_monat").select("monat, netto").in("monat", [`${jahr - 1}-11`, `${jahr - 1}-12`]),
  ]);

  const p = kasse?.jahr.prognose ?? null;
  const daten = (monat.data?.daten ?? {}) as { gewstHebesatz?: number; gewstFreibetrag?: number };
  const shopRows = (shop.data ?? []) as Array<{ monat: string; netto: number }>;
  const shopVon = (m: string) => {
    const r = shopRows.find((x) => String(x.monat) === m);
    return r ? Number(r.netto) : null;
  };

  const basis: SteuertippsBasis = {
    jahr,
    gewinnJahr: p?.gewinnJahr ?? null,
    gewinnQuelle: p ? `Hochrechnung aus ${p.monate} Monaten der Finanzübersicht (bis ${p.bisMonat})` : "keine Monatsdaten — Beispielwert",
    hebesatz: Number(daten.gewstHebesatz) || 460,
    freibetrag: Number(daten.gewstFreibetrag) || 24_500,
    mitarbeiter: staff.count ?? 0,
    shopNovVorjahr: shopVon(`${jahr - 1}-11`),
    shopDezVorjahr: shopVon(`${jahr - 1}-12`),
  };

  return <Steuertipps basis={basis} />;
}
