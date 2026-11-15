// Startbildschirm "Auffälligkeiten" — täglicher Prüfbericht (server-only, service_role).
// Jede Prüfung läuft für sich; schlägt eine fehl (Shopify/Sheet/Marketing nicht erreichbar),
// landet das in `fehler`, der Rest des Berichts bleibt vollständig.
// Schwellen stehen bewusst als Konstanten oben, damit sie leicht nachgeschärft werden können.
import { createServiceClient } from "@/lib/supabase/server";
import { loadCriticalStock } from "@/lib/stock-critical";
import { fetchUnfulfilledUnpaidOrders } from "@/lib/shopify";
import { hyBucket } from "@/lib/health";
import { ladeInstagram, ladeKampagnen, ladeLiquiditaet, ladeUmsatz, ladeWerbung } from "./daten";
import type { Auffaelligkeit, Bericht } from "./typen";

const S = {
  chatStunden: 4,             // Kundin wartet länger als so viele Stunden auf eine Antwort
  vorkasseTage: 7,            // unbezahlte Vorkasse-Bestellung älter als …
  vorkasseAltlast: 45,        // … ab so vielen Tagen gilt sie als Altlast (aufräumen statt nachhaken)
  manuellAnteil: 15,          // % manuell eingegebene statt gescannte Artikel (7 Tage)
  fotoSkipAnteil: 20,         // % Pakete ohne Foto (7 Tage)
  retourenFaktor: 2,          // Kollektion: Retouren 30 Tage ≥ Faktor × Ø der 3 Monate davor …
  retourenMin: 4,             // … und mindestens so viele
  datenAlterTage: 3,          // Datenquelle älter als … Tage = veraltet
  werbungFaktor: 0.6,         // Werbeausgaben 7 Tage < Faktor × Ø der 4 Wochen davor
  instaNeuFaktor: 0.7,        // neue Follower 7 Tage < Faktor × Ø der 4 Wochen davor
  umsatzWarn: -10,            // % Bestellwert gegen Vorjahr (gleiche Tage)
  umsatzAlarm: -25,
  aktionVorlaufTage: 21,      // so weit voraus sollte eine Aktion geplant sein
};

const berlin = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" });
const heute = () => berlin.format(new Date());
const plusTage = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const tageSeit = (iso: string) => Math.round((Date.parse(`${heute()}T12:00:00Z`) - Date.parse(`${iso.slice(0, 10)}T12:00:00Z`)) / 86_400_000);
const eur = (n: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const usd = (n: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const zahl = (n: number, d = 0) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: d }).format(n);
const kurz = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`;

type Pruefung = () => Promise<Auffaelligkeit[]>;

// ── Lager ───────────────────────────────────────────────────────────────────
const lager: Pruefung = async () => {
  const { items } = await loadCriticalStock();
  const name = (d: (typeof items)[number]) => `${d.product}${d.variant ? ` ${d.variant}` : ""} (${d.collection})`;
  const akutOhne = items.filter((d) => d.crit?.status === "akut" && d.unterwegsG <= 0);
  const lueckeOhne = items.filter((d) => (d.crit?.status === "luecke" || d.crit?.status === "knapp") && d.unterwegsG <= 0);
  const luecke = items.filter((d) => d.crit?.status === "luecke" && d.unterwegsG > 0);
  const out: Auffaelligkeit[] = [];
  if (akutOhne.length) out.push({
    id: "lager-akut", bereich: "lager", schwere: "hoch",
    titel: `${akutOhne.length} Produkt${akutOhne.length === 1 ? "" : "e"} gleich ausverkauft – nichts nachbestellt`,
    detail: "Reicht kürzer als die Lieferzeit, keine Bestellung unterwegs.",
    href: "/stock/critical", liste: akutOhne.slice(0, 6).map(name),
  });
  if (lueckeOhne.length) out.push({
    id: "lager-knapp", bereich: "lager", schwere: "mittel",
    titel: `${lueckeOhne.length} Produkt${lueckeOhne.length === 1 ? "" : "e"} werden knapp – nicht nachbestellt`,
    detail: "Lager reicht nicht bis zur nächsten möglichen Lieferung.",
    href: "/stock/critical", liste: lueckeOhne.slice(0, 6).map(name),
  });
  if (luecke.length) out.push({
    id: "lager-luecke", bereich: "lager", schwere: "mittel",
    titel: `${luecke.length} Produkt${luecke.length === 1 ? "" : "e"} mit Lieferlücke`,
    detail: "Bestellt, aber die Ware kommt erst, nachdem das Lager leer ist.",
    href: "/stock/critical", liste: luecke.slice(0, 6).map((d) => `${name(d)} · ${d.crit?.gapDays ?? "?"} Tage ohne Ware`),
  });
  return out;
};

// ── Chats ───────────────────────────────────────────────────────────────────
const chats: Pruefung = async () => {
  const sb = createServiceClient();
  const [{ data }, { count: eskaliert }] = await Promise.all([
    sb.rpc("cockpit_chats_unbeantwortet", { p_stunden: S.chatStunden }),
    sb.from("chat_sessions").select("id", { count: "exact", head: true }).eq("status", "awaiting_human"),
  ]);
  const r = (data as Array<{ anzahl: number; aelteste: string | null; ueber_24h: number }>)?.[0];
  const out: Auffaelligkeit[] = [];
  if (r && r.anzahl > 0) out.push({
    id: "chats-offen", bereich: "chats", schwere: r.ueber_24h >= 5 ? "hoch" : "mittel",
    titel: `${r.anzahl} Chat${r.anzahl === 1 ? "" : "s"} seit über ${S.chatStunden} Stunden unbeantwortet`,
    detail: `${r.ueber_24h} davon länger als einen Tag${r.aelteste ? `, die älteste seit ${kurz(berlin.format(new Date(r.aelteste)))}` : ""} – reine „Danke"-Nachrichten sind nicht mitgezählt.`,
    href: "/chatbot/inbox",
  });
  if ((eskaliert ?? 0) > 0) out.push({
    id: "chats-eskaliert", bereich: "chats", schwere: (eskaliert ?? 0) >= 5 ? "hoch" : "mittel",
    titel: `${eskaliert} Chat${eskaliert === 1 ? " wartet" : "s warten"} auf einen Menschen`,
    detail: "Der Bot hat an das Team übergeben.", href: "/chatbot/inbox",
  });
  return out;
};

// ── Werbung ─────────────────────────────────────────────────────────────────
const werbung: Pruefung = async () => {
  const w = await ladeWerbung();
  const out: Auffaelligkeit[] = [];
  if (!w.metaStand || tageSeit(w.metaStand) > S.datenAlterTage) out.push({
    id: "werbung-daten", bereich: "daten", schwere: "mittel",
    titel: "Meta-Werbedaten veraltet",
    detail: w.metaStand ? `Letzter Stand ${kurz(w.metaStand)} (${tageSeit(w.metaStand)} Tage). Der Meta-Schlüssel im Marketing-Projekt ist abgelaufen.` : "Keine Meta-Daten vorhanden.",
    href: "/marketing",
  });
  // Ø je Woche der 4 Wochen vor dem letzten 7-Tage-Fenster
  const ende = w.metaStand ?? heute();
  const vorher = w.tage.filter((t) => t.datum > plusTage(ende, -35) && t.datum <= plusTage(ende, -7));
  const schnitt = vorher.reduce((s, t) => s + t.meta + t.google, 0) / 4;
  const jetzt = w.meta7 + w.google7;
  if (jetzt === 0) out.push({ id: "werbung-null", bereich: "werbung", schwere: "hoch", titel: "Keine Werbung geschaltet", detail: `In den 7 Tagen bis ${kurz(ende)} wurde nichts ausgegeben.`, href: "/marketing" });
  else if (schnitt > 0 && jetzt < schnitt * S.werbungFaktor) out.push({
    id: "werbung-wenig", bereich: "werbung", schwere: "mittel",
    titel: "Deutlich weniger Werbung als sonst",
    detail: `${eur(jetzt)} in 7 Tagen gegen Ø ${eur(schnitt)} je Woche davor (−${zahl((1 - jetzt / schnitt) * 100)} %).`,
    href: "/marketing",
  });
  if (!w.googleStand) out.push({ id: "werbung-google", bereich: "werbung", schwere: "hinweis", titel: "Google Ads nicht angebunden", detail: "Das Google-Ads-Skript ist im Werbekonto noch nicht eingerichtet.", href: "/marketing" });
  return out;
};

// ── Aktionen ────────────────────────────────────────────────────────────────
const aktionen: Pruefung = async () => {
  const sb = createServiceClient();
  const h = heute();
  const [kamp, { data: eigene }] = await Promise.all([
    ladeKampagnen(),
    sb.from("cockpit_eintraege").select("titel, daten").eq("art", "aktion"),
  ]);
  const alle = [
    ...kamp.map((k) => ({ name: k.name, von: k.von, bis: k.bis })),
    ...((eigene ?? []) as Array<{ titel: string; daten: { von?: string; bis?: string } | null }>).map((e) => ({ name: e.titel, von: e.daten?.von ?? null, bis: e.daten?.bis ?? null })),
  ];
  const laufend = alle.filter((a) => (!a.von || a.von <= h) && (!a.bis || a.bis >= h));
  const geplant = alle.filter((a) => a.von && a.von > h && a.von <= plusTage(h, S.aktionVorlaufTage));
  if (laufend.length || geplant.length) return [];
  const naechste = alle.filter((a) => a.von && a.von > h).sort((a, b) => a.von!.localeCompare(b.von!))[0];
  return [{
    id: "aktionen-keine", bereich: "aktionen", schwere: "mittel",
    titel: "Keine Aktion läuft oder ist geplant",
    detail: naechste ? `Die nächste („${naechste.name}") beginnt erst am ${kurz(naechste.von!)}.` : `Für die nächsten ${S.aktionVorlaufTage} Tage ist nichts eingetragen.`,
  }];
};

// ── Vorkasse (unbezahlte Shopify-Bestellungen) ──────────────────────────────
const vorkasse: Pruefung = async () => {
  const offen = await fetchUnfulfilledUnpaidOrders(250);
  const alter = (o: (typeof offen)[number]) => tageSeit(berlin.format(new Date(o.createdAt)));
  // Nachhaken lohnt sich bei Bestellungen von vor 1–6 Wochen; ältere sind Altlasten zum Stornieren
  const nachhaken = offen.filter((o) => alter(o) > S.vorkasseTage && alter(o) <= S.vorkasseAltlast);
  const altlast = offen.filter((o) => alter(o) > S.vorkasseAltlast);
  const out: Auffaelligkeit[] = [];
  if (nachhaken.length) out.push({
    id: "vorkasse-ueberfaellig", bereich: "zahlungen", schwere: nachhaken.length >= 10 ? "hoch" : "mittel",
    titel: `${nachhaken.length} Vorkasse-Bestellung${nachhaken.length === 1 ? "" : "en"} seit über ${S.vorkasseTage} Tagen unbezahlt`,
    detail: `Zwischen ${S.vorkasseTage} und ${S.vorkasseAltlast} Tagen alt – Kundin erinnern oder stornieren.`,
    href: "/pack",
    liste: nachhaken.slice(0, 8).map((o) => `${o.name} · ${o.customerName ?? "?"} · seit ${alter(o)} Tagen`),
  });
  if (altlast.length >= 20) out.push({
    id: "vorkasse-altlast", bereich: "zahlungen", schwere: "hinweis",
    titel: `${altlast.length} uralte unbezahlte Bestellungen offen`,
    detail: `Älter als ${S.vorkasseAltlast} Tage – in Shopify stornieren, damit die Liste übersichtlich bleibt.`,
    href: "/pack",
  });
  return out;
};

// ── Liquidität + neue Auslandsbestellungen ──────────────────────────────────
const liquiditaet: Pruefung = async () => {
  const sb = createServiceClient();
  const [liq, { data: orders }] = await Promise.all([
    ladeLiquiditaet(),
    sb.from("orders_with_totals").select("label, status, weight_kg, remaining_balance, suppliers(name)").not("status", "in", "(draft,cancelled,hidden)"),
  ]);
  const out: Auffaelligkeit[] = [];
  if (liq.ampel === "alarm") out.push({
    id: "liq-luecke", bereich: "finanzen", schwere: "hoch",
    titel: "Liquiditätslücke in Sicht", detail: `Am ${kurz(liq.tiefpunkt.datum)} fehlen ${eur(-liq.tiefpunkt.saldo)}.`, href: "/finances/liquiditaet",
  });
  const kommend = ((orders ?? []) as Array<{ label: string; status: string; weight_kg: number | null; remaining_balance: number; suppliers: { name: string } | { name: string }[] | null }>)
    .filter((o) => hyBucket(o.status) === "kommend" || hyBucket(o.status) === "unterwegs");
  const kg = kommend.reduce((s, o) => s + Number(o.weight_kg ?? 0), 0);
  const offenUsd = kommend.reduce((s, o) => s + Number(o.remaining_balance ?? 0), 0);
  if (liq.ampel !== "ok" && kommend.length && offenUsd > 0) out.push({
    id: "liq-bestellungen", bereich: "finanzen", schwere: liq.ampel === "alarm" ? "hoch" : "mittel",
    titel: `Knappe Liquidität, aber ${zahl(kg)} kg Ware bestellt`,
    detail: `${kommend.length} Bestellungen in Produktion/unterwegs mit ${usd(offenUsd)} noch offen; tiefster Kontostand ${eur(liq.tiefpunkt.saldo)} am ${kurz(liq.tiefpunkt.datum)} (Reserve ${eur(liq.puffer)}).`,
    href: "/finances/liquiditaet",
    liste: kommend.slice(0, 6).map((o) => {
      const sup = Array.isArray(o.suppliers) ? o.suppliers[0] : o.suppliers;
      return `${sup?.name ?? "?"} · ${o.label} · ${o.weight_kg ? `${zahl(Number(o.weight_kg))} kg` : "kg ?"} · ${usd(Number(o.remaining_balance))} offen`;
    }),
  });
  return out;
};

// ── Versand: manuelle Eingaben und Pakete ohne Foto ─────────────────────────
const versand: Pruefung = async () => {
  const sb = createServiceClient();
  const seit = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [{ data: scans }, { data: sessions }, { data: profile }] = await Promise.all([
    sb.from("pack_scans").select("scan_method, status, scanned_by").gte("scanned_at", seit).in("status", ["match", "mismatch"]).limit(20000),
    sb.from("pack_sessions").select("photos_skipped, photos_skipped_by").gte("created_at", seit).limit(5000),
    sb.from("profiles").select("id, display_name"),
  ]);
  const namen = new Map(((profile ?? []) as Array<{ id: string; display_name: string | null }>).map((p) => [p.id, p.display_name ?? "?"]));
  const meist = (ids: Array<string | null>) => {
    const m = new Map<string, number>();
    for (const id of ids) if (id) m.set(id, (m.get(id) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, n]) => `${namen.get(id) ?? "?"}: ${n}`);
  };
  const out: Auffaelligkeit[] = [];
  const sc = (scans ?? []) as Array<{ scan_method: string; status: string; scanned_by: string | null }>;
  const manuell = sc.filter((s) => s.scan_method === "manual");
  const anteil = sc.length ? (manuell.length / sc.length) * 100 : 0;
  if (sc.length >= 50 && anteil > S.manuellAnteil) out.push({
    id: "versand-manuell", bereich: "versand", schwere: anteil > 2 * S.manuellAnteil ? "hoch" : "mittel",
    titel: `${zahl(anteil)} % der Artikel von Hand bestätigt statt gescannt`,
    detail: `${manuell.length} von ${sc.length} in 7 Tagen. Ohne Scan fallen Verwechslungen nicht auf.`,
    href: "/pack/stats", liste: meist(manuell.map((s) => s.scanned_by)),
  });
  const fehlscans = sc.filter((s) => s.status === "mismatch").length;
  if (fehlscans >= 20) out.push({ id: "versand-falsch", bereich: "versand", schwere: "hinweis", titel: `${fehlscans} falsche Artikel gescannt (7 Tage)`, detail: "Wurden beim Packen abgefangen – Lagerordnung prüfen.", href: "/pack/stats" });
  const ses = (sessions ?? []) as Array<{ photos_skipped: boolean; photos_skipped_by: string | null }>;
  const ohneFoto = ses.filter((s) => s.photos_skipped);
  const fotoAnteil = ses.length ? (ohneFoto.length / ses.length) * 100 : 0;
  if (ses.length >= 30 && fotoAnteil > S.fotoSkipAnteil) out.push({
    id: "versand-foto", bereich: "versand", schwere: "mittel",
    titel: `${zahl(fotoAnteil)} % der Pakete ohne Foto verschickt`,
    detail: `${ohneFoto.length} von ${ses.length} in 7 Tagen – bei Reklamationen fehlt dann der Nachweis.`,
    href: "/pack/stats", liste: meist(ohneFoto.map((s) => s.photos_skipped_by)),
  });
  return out;
};

// ── Retouren ────────────────────────────────────────────────────────────────
const retouren: Pruefung = async () => {
  const sb = createServiceClient();
  const { data: letzte } = await sb.from("returns").select("initiated_at").order("initiated_at", { ascending: false }).limit(1).maybeSingle();
  const out: Auffaelligkeit[] = [];
  const stand = (letzte as { initiated_at: string } | null)?.initiated_at ?? null;
  if (!stand || tageSeit(stand) > 7) out.push({
    id: "retouren-daten", bereich: "daten", schwere: "mittel",
    titel: "Retouren-Daten werden nicht mehr aktualisiert",
    detail: stand ? `Letzte erfasste Retoure vom ${kurz(stand)} (${tageSeit(stand)} Tage) – der Abgleich mit Shopify steht vermutlich.` : "Keine Retouren erfasst.",
    href: "/returns",
  });
  if (!stand) return out;
  // Ungewöhnlich viele Retouren je Kollektion / Farbe: letzte 30 Tage gegen Ø je 30 Tage der 90 davor.
  // Fenster am Datenstand ausrichten, sonst wären bei stehendem Abgleich alle Werte 0.
  const ende = stand.slice(0, 10);
  const rows: Array<{ collection_title: string | null; color: string | null; quantity: number | null; returns: { initiated_at: string } | { initiated_at: string }[] }> = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await sb.from("return_items").select("collection_title, color, quantity, returns!inner(initiated_at)")
      .gt("returns.initiated_at", plusTage(ende, -120)).lte("returns.initiated_at", ende).range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < 1000) break;
  }
  const pos = rows.map((r) => ({ k: r.collection_title ?? "?", f: r.color ?? null, n: Number(r.quantity ?? 1) || 1, tag: String((Array.isArray(r.returns) ? r.returns[0] : r.returns)?.initiated_at ?? "").slice(0, 10) }));
  const auffaellig = (schluessel: (p: (typeof pos)[number]) => string | null) => {
    const m = new Map<string, { jetzt: number; vorher: number }>();
    for (const p of pos) {
      const k = schluessel(p);
      if (!k) continue;
      const e = m.get(k) ?? { jetzt: 0, vorher: 0 };
      if (p.tag > plusTage(ende, -30)) e.jetzt += p.n; else e.vorher += p.n;
      m.set(k, e);
    }
    return [...m.entries()]
      .filter(([, e]) => e.jetzt >= S.retourenMin && e.jetzt >= S.retourenFaktor * Math.max(e.vorher / 3, 1))
      .sort((a, b) => b[1].jetzt - a[1].jetzt)
      .map(([k, e]) => `${k}: ${e.jetzt} in 30 Tagen (sonst Ø ${zahl(e.vorher / 3, 1)})`);
  };
  const kol = auffaellig((p) => p.k);
  const farben = auffaellig((p) => (p.f ? `${p.k} · ${p.f}` : null));
  if (kol.length || farben.length) out.push({
    id: "retouren-hoch", bereich: "retouren", schwere: "mittel",
    titel: "Ungewöhnlich viele Retouren",
    detail: `${kol.length ? `${kol.length} Kollektion${kol.length === 1 ? "" : "en"}` : ""}${kol.length && farben.length ? " und " : ""}${farben.length ? `${farben.length} Farbe${farben.length === 1 ? "" : "n"}` : ""} mit mindestens doppelt so vielen Retouren wie sonst (30 Tage bis ${kurz(ende)}).`,
    href: "/returns/analytics", liste: [...kol, ...farben].slice(0, 8),
  });
  return out;
};

// ── Steuern ─────────────────────────────────────────────────────────────────
const NAMEN: Record<string, string> = { ust_va: "USt-Voranmeldung", ust_nachzahlung: "USt-Nachzahlung", lst_anmeldung: "Lohnsteuer", est_vz: "ESt-Vorauszahlung", est_nachzahlung: "ESt-Nachzahlung", gewst_vz: "GewSt-Vorauszahlung", gewst_nachzahlung: "GewSt-Nachzahlung", eust: "Einfuhrumsatzsteuer", sonstige: "Sonstige Steuer" };
const steuern: Pruefung = async () => {
  const sb = createServiceClient();
  const h = heute();
  const { data } = await sb.from("steuer_posten").select("art, zeitraum, richtung, soll_betrag, ist_betrag, faellig_am, bezahlt_am, soll_schaetzung").gte("faellig_am", plusTage(h, -400));
  const p = (data ?? []) as Array<{ art: string; zeitraum: string; richtung: string; soll_betrag: number; ist_betrag: number | null; faellig_am: string | null; bezahlt_am: string | null; soll_schaetzung: boolean }>;
  const out: Auffaelligkeit[] = [];
  const ueber = p.filter((x) => x.richtung === "zahlung" && !x.bezahlt_am && Number(x.soll_betrag) > 0 && x.faellig_am && x.faellig_am < h);
  if (ueber.length) out.push({
    id: "steuer-ueberfaellig", bereich: "steuern", schwere: "hoch",
    titel: `${ueber.length} Steuerzahlung${ueber.length === 1 ? "" : "en"} überfällig`,
    detail: `${eur(ueber.reduce((s, x) => s + Number(x.soll_betrag), 0))} laut Steuer-Ledger noch nicht bezahlt.`,
    href: "/finances/prepayments",
    liste: ueber.map((x) => `${NAMEN[x.art] ?? x.art} ${x.zeitraum} · ${eur(Number(x.soll_betrag))} · fällig ${kurz(x.faellig_am!)}${x.soll_schaetzung ? " (geschätzt)" : ""}`),
  });
  const zuWenig = p.filter((x) => x.richtung === "zahlung" && x.bezahlt_am && !x.soll_schaetzung && Number(x.soll_betrag) > 0 && Number(x.ist_betrag ?? 0) < Number(x.soll_betrag) * 0.95);
  if (zuWenig.length) out.push({
    id: "steuer-zuwenig", bereich: "steuern", schwere: "mittel",
    titel: `${zuWenig.length} Steuerzahlung${zuWenig.length === 1 ? "" : "en"} niedriger als festgesetzt`,
    detail: `Zusammen ${eur(zuWenig.reduce((s, x) => s + Number(x.soll_betrag) - Number(x.ist_betrag ?? 0), 0))} weniger gezahlt als im Ledger als Soll steht.`,
    href: "/finances/prepayments",
    liste: zuWenig.slice(0, 6).map((x) => `${NAMEN[x.art] ?? x.art} ${x.zeitraum} · Soll ${eur(Number(x.soll_betrag))}, gezahlt ${eur(Number(x.ist_betrag ?? 0))}`),
  });
  // Vorauszahlungen, die im laufenden Jahr auf 0 stehen, obwohl es im Vorjahr welche gab
  const jahr = Number(h.slice(0, 4));
  for (const art of ["est_vz", "gewst_vz"]) {
    const dieses = p.filter((x) => x.art === art && x.zeitraum.includes(String(jahr)));
    const vorjahr = p.filter((x) => x.art === art && x.zeitraum.includes(String(jahr - 1)));
    const summe = (l: typeof p) => l.reduce((s, x) => s + Math.max(Number(x.soll_betrag), Number(x.ist_betrag ?? 0)), 0);
    if (vorjahr.length && summe(vorjahr) > 0 && summe(dieses) < summe(vorjahr) * 0.5) out.push({
      id: `steuer-${art}`, bereich: "steuern", schwere: "hinweis",
      titel: `${NAMEN[art]} ${jahr} deutlich niedriger als im Vorjahr`,
      detail: `${eur(summe(dieses))} gegen ${eur(summe(vorjahr))} in ${jahr - 1} – bei gutem Jahr droht eine Nachzahlung. Rücklage prüfen.`,
      href: "/finances/prepayments",
    });
  }
  return out;
};

// ── Instagram ───────────────────────────────────────────────────────────────
const instagram: Pruefung = async () => {
  const d = await ladeInstagram();
  if (!d.bisAm) return [];
  const out: Auffaelligkeit[] = [];
  const netto = d.d7.neu - d.d7.verloren;
  const vor4 = d.tage.filter((t) => t.tag > plusTage(d.bisAm!, -35) && t.tag <= plusTage(d.bisAm!, -7));
  const schnittNeu = vor4.reduce((s, t) => s + (t.neu ?? 0), 0) / 4;
  if (netto < 0) out.push({ id: "insta-minus", bereich: "instagram", schwere: "hoch", titel: "Instagram verliert Follower", detail: `${netto} netto in 7 Tagen (+${d.d7.neu} neu, −${d.d7.verloren} verloren).` });
  else if (d.d7.neu > 0 && d.d7.verloren / d.d7.neu > 0.8) out.push({ id: "insta-abgaenge", bereich: "instagram", schwere: "mittel", titel: "Viele Abgänge bei Instagram", detail: `${d.d7.verloren} verloren gegen ${d.d7.neu} neue Follower in 7 Tagen.` });
  if (schnittNeu > 0 && d.d7.neu < schnittNeu * S.instaNeuFaktor) out.push({
    id: "insta-wenig", bereich: "instagram", schwere: "mittel", titel: "Weniger neue Follower als sonst",
    detail: `${d.d7.neu} in 7 Tagen gegen Ø ${zahl(schnittNeu)} je Woche davor.`,
  });
  if (tageSeit(d.bisAm) > 4) out.push({ id: "insta-daten", bereich: "daten", schwere: "hinweis", titel: "Instagram-Zahlen nicht aktuell", detail: `Letzter vollständiger Tag ${kurz(d.bisAm)}.` });
  return out;
};

// ── Umsatz ──────────────────────────────────────────────────────────────────
const umsatz: Pruefung = async () => {
  const u = await ladeUmsatz();
  const tv = u.tageVergleich;
  if (!tv || tv.letztes <= 0) return [];
  const p = ((tv.dieses - tv.letztes) / tv.letztes) * 100;
  if (p > S.umsatzWarn) return [];
  return [{
    id: "umsatz-vorjahr", bereich: "umsatz", schwere: p <= S.umsatzAlarm ? "hoch" : "mittel",
    titel: `Bestellwert ${zahl(p)} % unter Vorjahr`,
    detail: `${eur(tv.dieses)} vom 1. bis ${tv.bisTag}. gegen ${eur(tv.letztes)} in denselben Tagen des Vorjahres.`,
    href: "/finances/overview",
  }];
};

const PRUEFUNGEN: Array<[string, Pruefung]> = [
  ["Lager", lager], ["Chats", chats], ["Werbung", werbung], ["Aktionen", aktionen], ["Vorkasse", vorkasse],
  ["Liquidität", liquiditaet], ["Versand", versand], ["Retouren", retouren], ["Steuern", steuern],
  ["Instagram", instagram], ["Umsatz", umsatz],
];

const RANG = { hoch: 0, mittel: 1, hinweis: 2 } as const;

export async function erstelleBericht(): Promise<Bericht> {
  const fehler: string[] = [];
  const ergebnisse = await Promise.all(PRUEFUNGEN.map(async ([name, f]) => {
    try {
      return await f();
    } catch (e) {
      fehler.push(`${name}: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}`);
      return [];
    }
  }));
  const punkte = ergebnisse.flat().sort((a, b) => RANG[a.schwere] - RANG[b.schwere]);
  return { tag: heute(), stand: new Date().toISOString(), punkte, fehler };
}

export async function speichereBericht(b: Bericht): Promise<void> {
  const { error } = await createServiceClient().from("cockpit_bericht").upsert({ tag: b.tag, punkte: b.punkte, fehler: b.fehler, stand: b.stand }, { onConflict: "tag" });
  if (error) throw new Error(error.message);
}

/** Neuester Bericht + Anzahl der Auffälligkeiten am Vortag (für "mehr/weniger als gestern"). */
export async function ladeBericht(): Promise<{ bericht: Bericht | null; vorher: { tag: string; hoch: number; gesamt: number } | null }> {
  const { data } = await createServiceClient().from("cockpit_bericht").select("tag, punkte, fehler, stand").order("tag", { ascending: false }).limit(2);
  const rows = (data ?? []) as Array<{ tag: string; punkte: Auffaelligkeit[]; fehler: string[]; stand: string }>;
  const b = rows[0] ? { tag: String(rows[0].tag).slice(0, 10), punkte: rows[0].punkte ?? [], fehler: rows[0].fehler ?? [], stand: rows[0].stand } : null;
  const v = rows[1] ? { tag: String(rows[1].tag).slice(0, 10), hoch: (rows[1].punkte ?? []).filter((p) => p.schwere === "hoch").length, gesamt: (rows[1].punkte ?? []).filter((p) => p.schwere !== "hinweis").length } : null;
  return { bericht: b, vorher: v };
}
