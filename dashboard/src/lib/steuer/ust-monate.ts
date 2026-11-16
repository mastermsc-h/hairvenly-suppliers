import { createServiceClient } from "@/lib/supabase/server";

type Sb = ReturnType<typeof createServiceClient>;

/** EU-Länder außer DE — Verkäufe dorthin laufen über OSS (ausländische USt), nicht über die deutsche Voranmeldung. */
const EU = new Set(["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"]);
/** Ausgaben, auf denen deutsche Vorsteuer (19 %) steckt. Ohne Versicherungen/Beiträge (steuerfrei) und
 *  ohne Software/Werbung aus dem Ausland (Reverse-Charge: USt und Vorsteuer heben sich auf). */
const VST_KATEGORIEN = new Set(["aus_versand", "aus_material", "aus_buero", "aus_steuerberater", "aus_telefon", "aus_energie", "aus_miete"]);
/** Salon-Einnahmen kommen aufs Treatwell-Konto (User 12.11.2026). */
const SALON_KONTO = "DE56290501010084626001";
/** Anteil der EUSt an einer Zoll-Abbuchung (Rest = Zoll 2,2 % auf den Warenwert, nicht abziehbar). */
const EUST_ANTEIL = (0.19 * 1.022) / (0.022 + 0.19 * 1.022);

export interface UstMonat {
  monat: string; // YYYY-MM
  /** Umsätze brutto: Shop Deutschland, Shop EU-Ausland (OSS), Shop Drittland, Salon. */
  shopDe: number;
  shopEu: number;
  shopDritt: number;
  salon: number;
  /** USt, die in Deutschland abzuführen ist: 19/119 von Shop DE + Salon. */
  ust: number;
  /** Abziehbar: Vorsteuer aus Inlandsrechnungen (geschätzt aus den Kontoumsätzen) + EUSt laut Abbuchungen. */
  vorsteuer: number;
  eust: number;
  /** ust − vorsteuer − eust (+ = Zahlung, − = Erstattung). */
  berechnet: number;
  /** Laut Finanzamt (+ Zahlung, − Erstattung); null = noch nicht bekannt. */
  finanzamt: number | null;
  /** Herkunft des Finanzamt-Werts. */
  quelle: "konto" | "eingetragen" | "schaetzung" | null;
  laufend: boolean;
}

async function alle<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 100_000; from += 1000) {
    const { data, error } = await q(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const r0 = (n: number) => Math.round(n);
const monatBerlin = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" }).slice(0, 7);

/** Umsatzsteuer-Rechnung je Monat eines Jahres (bis zum laufenden Monat). */
export async function ladeUstMonate(jahr: number, sb: Sb = createServiceClient()): Promise<UstMonat[]> {
  const heute = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const bisMonat = String(jahr) === heute.slice(0, 4) ? heute.slice(0, 7) : `${jahr}-12`;
  const monate = Array.from({ length: 12 }, (_, i) => `${jahr}-${String(i + 1).padStart(2, "0")}`).filter((m) => m <= bisMonat);
  if (!monate.length) return [];

  const [bestellungen, buchungen, posten] = await Promise.all([
    alle<{ created_at: string; land: string | null; umsatz_eur: number; storniert: boolean }>((from, to) =>
      sb.from("kunden_bestellungen").select("created_at, land, umsatz_eur, storniert")
        .gte("created_at", `${jahr - 1}-12-31T00:00:00Z`).lt("created_at", `${jahr + 1}-01-01T23:00:00Z`).order("created_at").range(from, to),
    ),
    alle<{ booking_date: string; amount: number; kategorie: string | null; account_iban: string | null }>((from, to) =>
      sb.from("bank_transactions").select("booking_date, amount, kategorie, account_iban")
        .gte("booking_date", `${jahr}-01-01`).lte("booking_date", `${jahr}-12-31`).order("booking_date").order("id").range(from, to),
    ),
    alle<{ zeitraum: string; richtung: string; ist_betrag: number; soll_betrag: number; soll_schaetzung: boolean | null; ist_quelle: string | null }>((from, to) =>
      sb.from("steuer_posten").select("zeitraum, richtung, ist_betrag, soll_betrag, soll_schaetzung, ist_quelle").eq("art", "ust_va").eq("jahr", jahr).range(from, to),
    ),
  ]);

  const leer = () => ({ shopDe: 0, shopEu: 0, shopDritt: 0, salon: 0, vstBasis: 0, eustAbb: 0 });
  const acc = new Map(monate.map((m) => [m, leer()]));
  for (const b of bestellungen) {
    if (b.storniert) continue;
    const a = acc.get(monatBerlin(b.created_at));
    if (!a) continue;
    const land = b.land ?? "DE";
    const wert = Number(b.umsatz_eur) || 0;
    if (land === "DE") a.shopDe += wert;
    else if (EU.has(land)) a.shopEu += wert;
    else a.shopDritt += wert;
  }
  for (const t of buchungen) {
    const a = acc.get(String(t.booking_date).slice(0, 7));
    if (!a) continue;
    const betrag = Number(t.amount);
    const k = t.kategorie ?? "";
    if (t.account_iban === SALON_KONTO && k.startsWith("ein_")) a.salon += betrag;
    else if (betrag < 0 && VST_KATEGORIEN.has(k)) a.vstBasis -= betrag;
    else if (betrag < 0 && k === "st_eust") a.eustAbb -= betrag;
  }
  const fa = new Map(posten.map((p) => [p.zeitraum, p]));

  return monate.map((m) => {
    const a = acc.get(m)!;
    const ust = ((a.shopDe + a.salon) * 19) / 119;
    const vorsteuer = (a.vstBasis * 19) / 119;
    const eust = a.eustAbb * EUST_ANTEIL;
    const p = fa.get(m);
    const vz = p?.richtung === "erstattung" ? -1 : 1;
    let finanzamt: number | null = null;
    let quelle: UstMonat["quelle"] = null;
    if (p && Number(p.ist_betrag) !== 0) {
      finanzamt = vz * Number(p.ist_betrag);
      quelle = p.ist_quelle === "bank" ? "konto" : "eingetragen";
    } else if (p && Number(p.soll_betrag) !== 0) {
      finanzamt = vz * Number(p.soll_betrag);
      quelle = p.soll_schaetzung ? "schaetzung" : "eingetragen";
    }
    return {
      monat: m,
      shopDe: r0(a.shopDe),
      shopEu: r0(a.shopEu),
      shopDritt: r0(a.shopDritt),
      salon: r0(a.salon),
      ust: r0(ust),
      vorsteuer: r0(vorsteuer),
      eust: r0(eust),
      berechnet: r0(ust - vorsteuer - eust),
      finanzamt: finanzamt === null ? null : r0(finanzamt),
      quelle,
      laufend: m === heute.slice(0, 7),
    };
  });
}
