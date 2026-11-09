import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/server";
import { requireEinnahmenAdmin } from "@/lib/actions/salon-einnahmen";
import {
  BEREICH_LABEL,
  berlinDatum,
  berlinLokal,
  berlinLokalZuIso,
  berlinZeit,
  summiere,
  type Bereich,
  type EinnahmeArt,
  type EinnahmeZeile,
} from "@/lib/salon/einnahmen";
import { ArtenVerwaltung, BearbeitenKnopf, HandyFreischalten, NeueEinnahmeKnopf, StornoKnopf, ZugangVerwaltung, type MitarbeiterOption } from "./einnahmen-ui";

export const dynamic = "force-dynamic";

const eur = (n: number) => n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const deDatum = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const wochentag = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("de-DE", { weekday: "short", timeZone: "UTC" });

function plusTage(d: string, n: number): string {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
const istDatum = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

type Params = { von?: string; bis?: string; bereich?: string; ma?: string };

export default async function EinnahmenPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireEinnahmenAdmin();
  const sp = await searchParams;
  const heute = berlinDatum(new Date());
  const monatsAnfang = `${heute.slice(0, 7)}-01`;
  const von = istDatum(sp.von) ?? monatsAnfang;
  const bis = istDatum(sp.bis) ?? heute;
  const bereich: Bereich | null = sp.bereich === "verkauf" || sp.bereich === "salon" ? sp.bereich : null;
  const maFilter = sp.ma && /^[0-9a-f-]{36}$/.test(sp.ma) ? sp.ma : null;

  const svc = createServiceClient();
  const vonIso = berlinLokalZuIso(`${von}T00:00`)!;
  const bisIso = berlinLokalZuIso(`${plusTage(bis, 1)}T00:00`)!;

  type Row = {
    id: string; employee_id: string; art_name: string; bereich: Bereich; betrag: number; zeitpunkt: string;
    notiz: string | null; storniert_am: string | null; storniert_von: "mitarbeiter" | "admin" | null;
    art_id: string | null; erfasst_von: "mitarbeiter" | "admin"; geaendert_am: string | null; erfasst_durch: string | null;
    original: { betrag: number; art_name: string; zeitpunkt: string; notiz: string | null } | null;
  };
  const rows: Row[] = [];
  for (let ab = 0; ; ab += 1000) {
    let q = svc
      .from("salon_einnahmen")
      .select("id, employee_id, art_name, bereich, betrag, zeitpunkt, notiz, storniert_am, storniert_von, art_id, erfasst_von, geaendert_am, original, erfasst_durch")
      .gte("zeitpunkt", vonIso)
      .lt("zeitpunkt", bisIso)
      .order("zeitpunkt", { ascending: false })
      .range(ab, ab + 999);
    if (bereich) q = q.eq("bereich", bereich);
    if (maFilter) q = q.eq("employee_id", maFilter);
    const { data } = await q;
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }

  const [{ data: emps }, { data: artRows }] = await Promise.all([
    svc.from("salon_employees").select("id, name, active, pin, einnahmen_erlaubt").order("name"),
    svc.from("salon_einnahme_arten").select("id, name, bereich, sortierung, aktiv").order("sortierung").order("name"),
  ]);
  const namen = new Map((emps ?? []).map((e) => [e.id, e.name as string]));
  const altePins = (emps ?? []).filter((e) => e.active && e.einnahmen_erlaubt && String(e.pin ?? "").length !== 6).map((e) => e.name as string);
  const arten: EinnahmeArt[] = (artRows ?? []).map((a) => ({ ...a, bereich: a.bereich as Bereich }));
  // Einnahmeperson: alle aktiven Mitarbeiter (die App-Berechtigung betrifft nur, wer erfassen darf)
  const maOptionen: MitarbeiterOption[] = (emps ?? []).map((e) => ({ id: e.id, name: e.name, active: e.active }));
  const zugang = (emps ?? []).filter((e) => e.active).map((e) => ({ id: e.id, name: e.name as string, erlaubt: !!e.einnahmen_erlaubt }));
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const originalText = (o: NonNullable<Row["original"]>) =>
    `Ursprünglich vom Mitarbeiter: ${eur(Number(o.betrag))} · ${o.art_name} · ${deDatum(berlinDatum(o.zeitpunkt))} ${berlinZeit(o.zeitpunkt)}${o.notiz ? ` · ${o.notiz}` : ""}`;

  const zeilen: EinnahmeZeile[] = rows.map((r) => ({
    id: r.id,
    employeeId: r.employee_id,
    employeeName: namen.get(r.employee_id) ?? "?",
    artName: r.art_name,
    bereich: r.bereich,
    betrag: Number(r.betrag),
    zeitpunkt: r.zeitpunkt,
    notiz: r.notiz,
    storniertAm: r.storniert_am,
    storniertVon: r.storniert_von,
  }));
  const { summe, proMitarbeiter, proTag } = summiere(zeilen);
  const stornoAnzahl = zeilen.filter((z) => z.storniertAm).length;

  const link = (p: Partial<Params>) => {
    const q = new URLSearchParams();
    const m = { von, bis, bereich: bereich ?? undefined, ma: maFilter ?? undefined, ...p };
    for (const [k, v] of Object.entries(m)) if (v) q.set(k, v);
    return `/salon-admin/einnahmen?${q.toString()}`;
  };
  const vormonatEnde = plusTage(monatsAnfang, -1);
  const montag = plusTage(heute, -((new Date(`${heute}T12:00:00Z`).getUTCDay() + 6) % 7));
  const schnell = [
    { label: "Heute", von: heute, bis: heute },
    { label: "Diese Woche", von: montag, bis: heute },
    { label: "Dieser Monat", von: monatsAnfang, bis: heute },
    { label: "Letzter Monat", von: `${vormonatEnde.slice(0, 7)}-01`, bis: vormonatEnde },
    { label: "Dieses Jahr", von: `${heute.slice(0, 4)}-01-01`, bis: heute },
  ];
  const maSpalten = proMitarbeiter.map((m) => ({ id: m.employeeId, name: m.name }));
  const pill = (aktiv: boolean) =>
    `rounded-full px-3 py-1 text-sm ${aktiv ? "bg-neutral-900 text-white" : "bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50"}`;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Einnahmen Laden & Salon</h1>
          <p className="text-sm text-neutral-500">
            Von den Mitarbeitern am iPad/iPhone erfasst (<span className="font-mono">/salon/einnahme</span>, mit PIN) — hier kannst du nachtragen, korrigieren und stornieren
          </p>
        </div>
        <NeueEinnahmeKnopf mitarbeiter={maOptionen} arten={arten} />
      </div>

      <HandyFreischalten />

      {altePins.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Noch ohne 6-stellige PIN (können keine Einnahmen erfassen): <b>{altePins.join(", ")}</b> —{" "}
          <Link href="/salon-admin/mitarbeiter" className="underline font-medium">PINs vergeben</Link>
        </div>
      )}

      {/* Filter */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap gap-2">
          {schnell.map((s) => (
            <Link key={s.label} href={link({ von: s.von, bis: s.bis })} className={pill(von === s.von && bis === s.bis)}>
              {s.label}
            </Link>
          ))}
        </div>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide">
            Von
            <input type="date" name="von" defaultValue={von} className="mt-1 block rounded-lg border border-neutral-300 px-3 py-2 text-sm normal-case" />
          </label>
          <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide">
            Bis
            <input type="date" name="bis" defaultValue={bis} className="mt-1 block rounded-lg border border-neutral-300 px-3 py-2 text-sm normal-case" />
          </label>
          <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide">
            Bereich
            <select name="bereich" defaultValue={bereich ?? ""} className="mt-1 block rounded-lg border border-neutral-300 px-3 py-2 text-sm normal-case">
              <option value="">Salon + Verkauf</option>
              <option value="verkauf">Nur Verkauf</option>
              <option value="salon">Nur Salon</option>
            </select>
          </label>
          <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide">
            Mitarbeiter
            <select name="ma" defaultValue={maFilter ?? ""} className="mt-1 block rounded-lg border border-neutral-300 px-3 py-2 text-sm normal-case">
              <option value="">Alle</option>
              {maOptionen.map((e) => (
                <option key={e.id} value={e.id}>{e.name}{e.active ? "" : " (inaktiv)"}</option>
              ))}
            </select>
          </label>
          <button className="bg-neutral-900 text-white font-medium rounded-lg px-4 py-2 text-sm">Anzeigen</button>
          {(bereich || maFilter) && (
            <Link href={link({ bereich: undefined, ma: undefined })} className="text-sm text-neutral-500 hover:text-neutral-900 py-2">
              Filter zurücksetzen
            </Link>
          )}
        </form>
      </div>

      {/* Summen */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: bereich ? `Gesamt (${BEREICH_LABEL[bereich]})` : "Gesamt", wert: eur(summe.gesamt), href: link({ bereich: undefined }) },
          { label: "Verkauf", wert: eur(summe.verkauf), href: link({ bereich: "verkauf" }) },
          { label: "Salon", wert: eur(summe.salon), href: link({ bereich: "salon" }) },
          { label: "Einträge", wert: String(summe.anzahl), sub: stornoAnzahl ? `+ ${stornoAnzahl} storniert` : undefined },
        ].map((k) => {
          const inner = (
            <>
              <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide">{k.label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{k.wert}</div>
              {k.sub && <div className="text-xs text-neutral-400">{k.sub}</div>}
            </>
          );
          return k.href ? (
            <Link key={k.label} href={k.href} className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm hover:border-neutral-400">{inner}</Link>
          ) : (
            <div key={k.label} className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">{inner}</div>
          );
        })}
      </div>
      <p className="text-xs text-neutral-500 -mt-3">
        {deDatum(von)} – {deDatum(bis)}
        {maFilter ? ` · nur ${namen.get(maFilter) ?? "?"}` : ""}
        {bereich ? ` · nur ${BEREICH_LABEL[bereich]}` : ""} · stornierte Einträge zählen nicht
      </p>

      {/* Nach Mitarbeiter */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-600 mb-3">Nach Mitarbeiter</h2>
        {proMitarbeiter.length === 0 ? (
          <div className="text-sm text-neutral-500">Keine Einnahmen im Zeitraum.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-xs uppercase text-neutral-500">
                  <th className="text-left py-2 pr-2">Mitarbeiter</th>
                  <th className="text-right py-2 px-2">Verkauf</th>
                  <th className="text-right py-2 px-2">Salon</th>
                  <th className="text-right py-2 px-2">Gesamt</th>
                  <th className="text-right py-2 px-2">Einträge</th>
                  <th className="text-right py-2 pl-2">Anteil</th>
                </tr>
              </thead>
              <tbody>
                {proMitarbeiter.map((m) => (
                  <tr key={m.employeeId} className="border-b border-neutral-100">
                    <td className="py-2 pr-2">
                      <Link href={link({ ma: m.employeeId })} className="font-medium hover:underline">{m.name}</Link>
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums">{eur(m.verkauf)}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{eur(m.salon)}</td>
                    <td className="py-2 px-2 text-right tabular-nums font-semibold">{eur(m.gesamt)}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-neutral-500">{m.anzahl}</td>
                    <td className="py-2 pl-2 text-right tabular-nums text-neutral-500">
                      {summe.gesamt > 0 ? `${Math.round((m.gesamt / summe.gesamt) * 100)} %` : "—"}
                    </td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-2 pr-2">Summe</td>
                  <td className="py-2 px-2 text-right tabular-nums">{eur(summe.verkauf)}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{eur(summe.salon)}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{eur(summe.gesamt)}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-neutral-500">{summe.anzahl}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Tage × Mitarbeiter */}
      {proTag.length > 0 && (
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-600 mb-3">Pro Tag</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-xs uppercase text-neutral-500">
                  <th className="text-left py-2 pr-2">Tag</th>
                  {!bereich && <th className="text-right py-2 px-2">Verkauf</th>}
                  {!bereich && <th className="text-right py-2 px-2">Salon</th>}
                  <th className="text-right py-2 px-2">Gesamt</th>
                  {maSpalten.length > 1 && maSpalten.map((m) => (
                    <th key={m.id} className="text-right py-2 px-2 normal-case font-medium whitespace-nowrap">{m.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {proTag.map((t) => (
                  <tr key={t.datum} className="border-b border-neutral-100">
                    <td className="py-2 pr-2 whitespace-nowrap">
                      <span className="text-neutral-400 w-8 inline-block">{wochentag(t.datum)}</span> {deDatum(t.datum)}
                    </td>
                    {!bereich && <td className="py-2 px-2 text-right tabular-nums">{eur(t.verkauf)}</td>}
                    {!bereich && <td className="py-2 px-2 text-right tabular-nums">{eur(t.salon)}</td>}
                    <td className="py-2 px-2 text-right tabular-nums font-semibold">{eur(t.gesamt)}</td>
                    {maSpalten.length > 1 && maSpalten.map((m) => (
                      <td key={m.id} className="py-2 px-2 text-right tabular-nums text-neutral-600">
                        {t.proMitarbeiter[m.id] ? eur(t.proMitarbeiter[m.id]) : <span className="text-neutral-300">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Einträge */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-600 mb-3">Alle Einträge ({zeilen.length})</h2>
        {zeilen.length === 0 ? (
          <div className="text-sm text-neutral-500">Keine Einträge im Zeitraum.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-xs uppercase text-neutral-500">
                  <th className="text-left py-2 pr-2">Datum</th>
                  <th className="text-left py-2 px-2">Mitarbeiter</th>
                  <th className="text-left py-2 px-2">Art</th>
                  <th className="text-left py-2 px-2">Notiz</th>
                  <th className="text-right py-2 px-2">Betrag</th>
                  <th className="py-2 pl-2" />
                </tr>
              </thead>
              <tbody>
                {zeilen.map((z) => (
                  <tr key={z.id} className={`border-b border-neutral-100 align-top ${z.storniertAm ? "text-neutral-400" : ""}`}>
                    <td className="py-2 pr-2 whitespace-nowrap tabular-nums">
                      {deDatum(berlinDatum(z.zeitpunkt))} <span className="text-neutral-400">{berlinZeit(z.zeitpunkt)}</span>
                    </td>
                    <td className="py-2 px-2 whitespace-nowrap">{z.employeeName}</td>
                    <td className="py-2 px-2">
                      <span className={`mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium ${z.bereich === "verkauf" ? "bg-sky-100 text-sky-800" : "bg-rose-100 text-rose-800"}`}>
                        {BEREICH_LABEL[z.bereich]}
                      </span>
                      {z.artName}
                    </td>
                    <td className="py-2 px-2 text-neutral-600 max-w-xs">
                      {z.notiz}
                      {(() => {
                        const r = rowById.get(z.id)!;
                        const durch = r.erfasst_durch && r.erfasst_durch !== r.employee_id ? namen.get(r.erfasst_durch) : null;
                        if (durch && !r.geaendert_am) return <div className="text-[11px] text-neutral-400">erfasst von {durch}</div>;
                        if (r.erfasst_von === "admin") return <div className="text-[11px] text-neutral-400">von dir nachgetragen{r.geaendert_am ? ", geändert" : ""}</div>;
                        if (r.geaendert_am)
                          return (
                            <div className="text-[11px] text-amber-700" title={r.original ? originalText(r.original) : undefined}>
                              {durch ? `erfasst von ${durch}, ` : ""}von dir geändert {deDatum(berlinDatum(r.geaendert_am))}{r.original ? ` · vorher ${eur(Number(r.original.betrag))}` : ""}
                            </div>
                          );
                        return null;
                      })()}
                    </td>
                    <td className={`py-2 px-2 text-right tabular-nums font-medium whitespace-nowrap ${z.storniertAm ? "line-through" : ""}`}>{eur(z.betrag)}</td>
                    <td className="py-2 pl-2 text-right whitespace-nowrap">
                      {z.storniertAm && (
                        <span className="mr-2 text-xs">storniert ({z.storniertVon === "admin" ? "du" : "Mitarbeiter"})</span>
                      )}
                      {!z.storniertAm && (
                        <BearbeitenKnopf
                          mitarbeiter={maOptionen}
                          arten={arten}
                          eintrag={{
                            id: z.id,
                            employeeId: z.employeeId,
                            artId: rowById.get(z.id)!.art_id,
                            artName: z.artName,
                            bereich: z.bereich,
                            betrag: z.betrag,
                            zeitpunkt: berlinLokal(z.zeitpunkt),
                            notiz: z.notiz,
                          }}
                        />
                      )}
                      <StornoKnopf id={z.id} storniert={!!z.storniertAm} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ZugangVerwaltung mitarbeiter={zugang} />

      <ArtenVerwaltung arten={arten} />
    </div>
  );
}
