// Salon-Umsatz je Monat aus dem Treatwell-Konto (server-only, service_role, OHNE Rechteprüfung —
// Aufrufer prüfen vorher das Finanzen-Recht). Bewusst keine "use server"-Datei, damit das nicht
// als Server-Action von außen aufrufbar ist.
import { createServiceClient } from "@/lib/supabase/server";
import type { SalonUmsatzMonat } from "@/lib/types";

/** Salon-Umsätze eines Jahres = Eingänge auf dem Treatwell-Konto (alle Salon-Einnahmen laufen dorthin). */
export async function salonUmsatzJahr(jahr: number): Promise<SalonUmsatzMonat[]> {
  const svc = createServiceClient();
  const rows: Array<{ booking_date: string; amount: number; kategorie: string }> = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await svc
      .from("bank_transactions")
      .select("booking_date, amount, kategorie")
      .eq("account_iban", "DE56290501010084626001")
      .like("kategorie", "ein_%")
      .gte("booking_date", `${jahr}-01-01`)
      .lte("booking_date", `${jahr}-12-31`)
      .order("booking_date")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < 1000) break;
  }
  const by = new Map<string, SalonUmsatzMonat>();
  for (const r of rows) {
    const monat = String(r.booking_date).slice(0, 7);
    const m = by.get(monat) ?? { monat, brutto: 0, karte: 0, online: 0, bar: 0, sonstige: 0 };
    const betrag = Number(r.amount) || 0;
    m.brutto += betrag;
    if (r.kategorie === "ein_karte") m.karte += betrag;
    else if (r.kategorie === "ein_treatwell") m.online += betrag;
    else if (r.kategorie === "ein_bargeld") m.bar += betrag;
    else m.sonstige += betrag;
    by.set(monat, m);
  }
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return [...by.values()].map((m) => ({ ...m, brutto: r2(m.brutto), karte: r2(m.karte), online: r2(m.online), bar: r2(m.bar), sonstige: r2(m.sonstige) })).sort((a, b) => a.monat.localeCompare(b.monat));
}
