"use client";

// Anzeige-Widgets des Startbildschirms: bekommen fertige Zahlen vom Server.
import { useState } from "react";
import Link from "next/link";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, ComposedChart, Line } from "recharts";
import {
  AlertTriangle, ArrowRight, Check, CheckCircle2, Globe2, Landmark, Lock, Package, ShoppingBag, ShoppingCart, Sparkles, TrendingDown,
  Undo2, Users, XCircle,
} from "lucide-react";
import type { IgAnfragenDaten, WerbungDaten, InstagramDaten, TotesKapitalDaten, AuslandDaten, BesucherDaten, LiqGruppe, ChatDaten, HyDaten, LiquiditaetDaten, PflichtenDaten, ShopifyDaten, Signal, UmsatzDaten } from "@/lib/cockpit/typen";
import { Balken, Delta, Funke, Hinweis, Ring, Symbol, Zahl, eur, kurzEur, monatName, tagMonat, zahl } from "./bausteine";

function Mehr({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="ck-link" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{children} <ArrowRight size={12} /></Link>;
}

// ── Lagebild ────────────────────────────────────────────────────────────────

const SIGNAL_ICON = { ok: Check, warn: AlertTriangle, alarm: AlertTriangle } as const;

export function LageWidget({ signale }: { signale: Signal[] }) {
  if (!signale.length) return <Hinweis>Noch keine Signale – sobald Daten da sind, steht hier, wo es läuft und wo es hakt.</Hinweis>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
      {signale.map((s, i) => {
        const Icon = SIGNAL_ICON[s.ampel];
        const inhalt = (
          <>
            <span className="ck-signal-icon"><Icon size={13} strokeWidth={2.6} /></span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 650, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.titel}</div>
              <div className="ck-dim" style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.detail}</div>
            </div>
          </>
        );
        return s.href
          ? <Link key={i} href={s.href} className="ck-signal" data-ampel={s.ampel} title={`${s.titel} – ${s.detail}`}>{inhalt}</Link>
          : <div key={i} className="ck-signal" data-ampel={s.ampel} title={`${s.titel} – ${s.detail}`}>{inhalt}</div>;
      })}
    </div>
  );
}

// ── Chats ───────────────────────────────────────────────────────────────────

export function ChatsWidget({ d }: { d: ChatDaten }) {
  const max = Math.max(...d.serie.map((s) => s.n), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {[
          { label: "7 Tage", neu: d.d7, alt: d.p7, farbig: true },
          { label: "30 Tage", neu: d.d30, alt: d.p30, farbig: false },
        ].map((x) => (
          <div key={x.label}>
            <div className="ck-etikett">{x.label}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginTop: 3, flexWrap: "wrap" }}>
              <Zahl wert={x.neu} className={`ck-gross ${x.farbig ? "ck-farbig" : ""}`} />
              <Delta neu={x.neu} alt={x.alt} />
            </div>
            <div className="ck-matt" style={{ fontSize: 11.5, marginTop: 2 }}>davor {zahl(x.alt)}</div>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 34 }}>
        <div className="ck-saeulen" role="img" aria-label="Neue Chats pro Tag, letzte 30 Tage">
          {d.serie.map((s, i) => (
            <i key={s.tag} data-neu={i >= d.serie.length - 7} title={`${tagMonat(s.tag)} ${zahl(s.n)} Chats`} style={{ height: `${Math.max(6, (s.n / max) * 100)}%`, ["--n" as string]: i }} />
          ))}
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="ck-matt" style={{ fontSize: 11 }}>pro Tag · kräftig = letzte 7 Tage</span>
        <Mehr href="/chatbot/stats">Statistik</Mehr>
      </div>
    </div>
  );
}

// ── Umsatz (farbige Hauptkachel) ────────────────────────────────────────────

function UmsatzTipp({ active, payload, label, jahr }: { active?: boolean; payload?: Array<{ dataKey?: string | number; value?: number | null }>; label?: string; jahr: number }) {
  if (!active || !payload?.length) return null;
  const w = (k: string) => payload.find((p) => p.dataKey === k)?.value;
  return (
    <div className="ck-tipp">
      <div style={{ fontWeight: 650, marginBottom: 3 }}>{label}</div>
      <div><b style={{ color: "#7c5cff" }}>{jahr}:</b> {w("dieses") != null ? eur(Number(w("dieses"))) : "–"}</div>
      <div style={{ color: "#666c8c" }}>{jahr - 1}: {w("letztes") != null ? eur(Number(w("letztes"))) : "keine Daten"}</div>
    </div>
  );
}

export function UmsatzWidget({ d }: { d: UmsatzDaten }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 10 }}>
        <div>
          <div className="ck-etikett">{monatName(d.monat)} bisher{d.live ? "" : d.stand ? ` · Stand ${tagMonat(d.stand.slice(0, 10))}, ohne heute` : ""}</div>
          <div style={{ marginTop: 4 }}><Zahl wert={d.monatNetto} format="eur" className="ck-riesig" /></div>
          {d.tageVergleich ? (
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 8, flexWrap: "wrap" }} title={`Bestellwert vor Erstattungen, 1.–${d.tageVergleich.bisTag}. des Monats: ${eur(d.tageVergleich.dieses)} gegen ${eur(d.tageVergleich.letztes)} im Vorjahr`}>
              <Delta neu={d.tageVergleich.dieses} alt={d.tageVergleich.letztes} />
              <span className="ck-dim" style={{ fontSize: 12 }}>zu denselben Tagen {d.jahr - 1}</span>
            </div>
          ) : <div className="ck-matt" style={{ fontSize: 12, marginTop: 8 }}>Vorjahresvergleich gerade nicht verfügbar</div>}
        </div>
        <div className="ck-glas">
          <div className="ck-etikett">Jahr {d.jahr}</div>
          <div style={{ marginTop: 3 }}><Zahl wert={d.jahrNetto} format="kurzEur" className="ck-mittel" /></div>
          {d.vergleich && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, flexWrap: "wrap" }} title={`${d.vergleich.label}: ${eur(d.vergleich.dieses)} gegen ${eur(d.vergleich.letztes)}`}>
              <Delta neu={d.vergleich.dieses} alt={d.vergleich.letztes} />
              <span className="ck-dim" style={{ fontSize: 11.5 }}>{d.vergleich.label} zu {d.jahr - 1}</span>
            </div>
          )}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 90 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={d.monate} barGap={2} margin={{ top: 6, right: 0, left: 0, bottom: 0 }}>
            <XAxis dataKey="m" tickLine={false} axisLine={false} interval={0} />
            <YAxis hide />
            <Tooltip cursor={{ fill: "rgba(255,255,255,0.14)" }} content={<UmsatzTipp jahr={d.jahr} />} />
            <Bar dataKey="letztes" fill="rgba(255,255,255,0.38)" radius={[4, 4, 0, 0]} animationDuration={900} />
            <Bar dataKey="dieses" fill="#ffffff" radius={[4, 4, 0, 0]} animationDuration={1100} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="ck-dim" style={{ fontSize: 11.5, display: "inline-flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}><i className="ck-legende" style={{ background: "#fff" }} />{d.jahr}</span>
          <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}><i className="ck-legende" style={{ background: "rgba(255,255,255,0.4)" }} />{d.jahr - 1}</span>
          <span>bei gleichem Tempo {kurzEur(d.hochrechnung)} im Monat</span>
        </span>
        <Mehr href="/finances/overview">Finanzen</Mehr>
      </div>
    </div>
  );
}

// ── HY-Score ────────────────────────────────────────────────────────────────

export function HyWidget({ d }: { d: HyDaten | null }) {
  if (!d) return <Hinweis>Noch kein HY-Score gespeichert.</Hinweis>;
  const teile = [
    { label: "Lager", wert: `${zahl(d.kg)} kg`, punkte: d.kg, farbe: "#7c5cff", Icon: Package, vz: "+" },
    { label: "Konten", wert: kurzEur(d.kontenEur), punkte: d.kontenEur / 1000, farbe: "#12b76a", Icon: Landmark, vz: "+" },
    { label: "Schulden", wert: kurzEur(d.schuldenEur), punkte: d.schuldenEur / 1000, farbe: "#ee3f6f", Icon: TrendingDown, vz: "−" },
  ];
  const plus = teile[0].punkte + teile[1].punkte;
  const basis = Math.max(plus, teile[2].punkte, 1);
  const delta = d.delta7 != null ? { d: d.delta7, text: "in 7 Tagen" } : d.deltaSeit ? { d: d.deltaSeit.delta, text: `seit ${tagMonat(d.deltaSeit.tag)}` } : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
        <Zahl wert={d.score} nachkomma={1} className="ck-riesig ck-farbig" />
        {delta && (
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center", paddingBottom: 5 }}>
            <Delta neu={d.score} alt={d.score - delta.d} absolut /><span className="ck-matt" style={{ fontSize: 11.5 }}>{delta.text}</span>
          </span>
        )}
      </div>

      {/* Waage: was da ist (Lager + Konten) gegen das, was abgeht (Schulden) */}
      <div role="img" aria-label="Lager und Konten gegen Schulden">
        <div style={{ display: "flex", height: 14, borderRadius: 999, overflow: "hidden", background: "rgba(96,84,150,0.1)" }}>
          {teile.slice(0, 2).map((t) => (
            <i key={t.label} style={{ width: `${(t.punkte / basis) * 100}%`, background: t.farbe, display: "block" }} title={`${t.label} ${t.wert}`} />
          ))}
        </div>
        <div style={{ display: "flex", height: 14, borderRadius: 999, overflow: "hidden", background: "rgba(96,84,150,0.1)", marginTop: 5 }}>
          <i style={{ width: `${(teile[2].punkte / basis) * 100}%`, background: teile[2].farbe, display: "block" }} title={`Schulden ${teile[2].wert}`} />
        </div>
      </div>

      <div style={{ display: "grid", gap: 7 }}>
        {teile.map((t) => (
          <div key={t.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Symbol farbe={t.farbe} groesse={32}><t.Icon size={16} /></Symbol>
            <span style={{ fontSize: 13, flex: 1 }}>{t.label}</span>
            <span className="ck-mono" style={{ fontSize: 14, fontWeight: 650 }}><span style={{ color: t.farbe }}>{t.vz}</span> {t.wert}</span>
          </div>
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 30, display: "flex", alignItems: "flex-end" }}>
        <Funke werte={d.serie.map((s) => s.score)} hoehe={40} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="ck-matt" style={{ fontSize: 11 }}>Stand {tagMonat(d.stand.slice(0, 10))}</span>
        <Mehr href="/health">Details</Mehr>
      </div>
    </div>
  );
}

// ── Shopify ─────────────────────────────────────────────────────────────────

const KANAL_FARBEN = ["#12b76a", "#7c5cff", "#2f9bff", "#9a9fb8"];

export function ShopifyWidget({ d }: { d: ShopifyDaten }) {
  const topMax = Math.max(...d.topseller.map((t) => t.stueck), 1);
  const kanalSumme = d.kanaele.reduce((s, k) => s + k.wert, 0) || 1;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 8 }}>
        <div style={{ borderRadius: 14, padding: "9px 12px", color: "#fff", background: "linear-gradient(135deg, #12b76a, #47d79a)", position: "relative", overflow: "hidden" }}>
          <ShoppingBag size={54} style={{ position: "absolute", right: -8, bottom: -10, opacity: 0.2 }} />
          <div style={{ fontSize: 11.5, fontWeight: 600, opacity: 0.9 }}>Heute</div>
          {d.heute ? (
            <>
              <div style={{ marginTop: 2 }}><Zahl wert={d.heute.umsatz} format="eur" className="ck-mittel" /></div>
              <div style={{ fontSize: 12, opacity: 0.92 }}>{zahl(d.heute.bestellungen)} Bestellungen</div>
            </>
          ) : <div style={{ fontSize: 12, marginTop: 4 }}>Shopify gerade nicht erreichbar</div>}
        </div>
        <div className="ck-kachel">
          <div className="ck-etikett">Gestern</div>
          {d.gestern ? (
            <>
              <div style={{ marginTop: 2 }}><Zahl wert={d.gestern.umsatz} format="eur" className="ck-mittel" /></div>
              <div className="ck-dim" style={{ fontSize: 12 }}>{zahl(d.gestern.bestellungen)} Bestellungen</div>
            </>
          ) : <div className="ck-matt" style={{ fontSize: 12, marginTop: 4 }}>–</div>}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <div className="ck-kachel" style={{ textAlign: "center", padding: "8px 4px" }}>
          <div style={{ display: "grid", placeItems: "center" }}><Symbol farbe="#2f9bff" groesse={30}><ShoppingCart size={15} /></Symbol></div>
          <div className="ck-mono" style={{ fontSize: 14.5, fontWeight: 700, marginTop: 4 }}>{d.warenkorb != null ? eur(d.warenkorb) : "–"}</div>
          <div className="ck-matt" style={{ fontSize: 11 }}>Ø Warenkorb</div>
        </div>
        <div className="ck-kachel" style={{ textAlign: "center", padding: "8px 4px" }}>
          <div style={{ display: "grid", placeItems: "center" }}><Symbol farbe="#ee3f6f" groesse={30}><Undo2 size={15} /></Symbol></div>
          <div className="ck-mono" style={{ fontSize: 14.5, fontWeight: 700, marginTop: 4 }}>{d.erstattungsQuote != null ? `${zahl(d.erstattungsQuote, 1)} %` : "–"}</div>
          <div className="ck-matt" style={{ fontSize: 11 }}>erstattet</div>
        </div>
        <div className="ck-kachel" style={{ textAlign: "center", padding: "8px 4px" }}>
          {d.neukundenAnteil != null ? (
            <>
              <div style={{ display: "grid", placeItems: "center" }}>
                <Ring anteil={d.neukundenAnteil} groesse={30} dicke={5} farbe="#7c5cff"><Users size={12} style={{ color: "#7c5cff" }} /></Ring>
              </div>
              <div className="ck-mono" style={{ fontSize: 14.5, fontWeight: 700, marginTop: 4 }}>{d.neukundenAnteil} %</div>
              <div className="ck-matt" style={{ fontSize: 11 }}>Neukundinnen</div>
            </>
          ) : <div className="ck-matt" style={{ fontSize: 12 }}>–</div>}
        </div>
      </div>

      {d.topseller.length > 0 && (
        <div>
          <div className="ck-etikett" style={{ marginBottom: 6, display: "flex", gap: 5, alignItems: "center" }}><Sparkles size={12} /> Meistverkauft in 30 Tagen</div>
          <div style={{ display: "grid", gap: 6 }}>
            {d.topseller.map((t) => (
              <div key={t.name}>
                <div className="ck-zeile" style={{ padding: "0 0 2px" }}>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5 }}>{t.name}</span>
                  <span className="ck-mono" style={{ fontSize: 12, fontWeight: 650 }}>{zahl(t.stueck)}</span>
                </div>
                <Balken anteil={(t.stueck / topMax) * 100} />
              </div>
            ))}
          </div>
        </div>
      )}

      {d.kanaele.length > 1 && (
        <div>
          <div className="ck-etikett" style={{ marginBottom: 6 }}>Woher der Umsatz kam (Vormonat)</div>
          <div style={{ display: "flex", height: 12, borderRadius: 999, overflow: "hidden" }}>
            {d.kanaele.slice(0, 4).map((k, i) => <i key={k.name} title={`${k.name} ${eur(k.wert)}`} style={{ width: `${(k.wert / kanalSumme) * 100}%`, background: KANAL_FARBEN[i], display: "block" }} />)}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 6 }}>
            {d.kanaele.slice(0, 3).map((k, i) => (
              <span key={k.name} className="ck-dim" style={{ fontSize: 11.5, display: "inline-flex", gap: 5, alignItems: "center" }}>
                <i className="ck-legende" style={{ background: KANAL_FARBEN[i] }} />{k.name} {Math.round((k.wert / kanalSumme) * 100)} %
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Auslandsbestellungen ────────────────────────────────────────────────────

const LAND_FARBEN = ["#0ea5e9", "#7c5cff", "#f0508f", "#9a9fb8"];
/** ISO-Code → Flaggen-Emoji ("AT" → 🇦🇹). */
const flagge = (code: string) => (/^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : "🌍");

function AuslandTipp({ active, payload, label, reihen }: { active?: boolean; payload?: Array<{ dataKey?: string | number; value?: number }>; label?: string; reihen: AuslandDaten["reihen"] }) {
  if (!active || !payload?.length) return null;
  const summe = payload.reduce((s, p) => s + (Number(p.value) || 0), 0);
  return (
    <div className="ck-tipp">
      <div style={{ fontWeight: 650, marginBottom: 3 }}>Woche ab {label} · {zahl(summe)} Bestellungen</div>
      {reihen.map((r, i) => {
        const v = Number(payload.find((p) => p.dataKey === r.code)?.value) || 0;
        return v ? <div key={r.code}><b style={{ color: LAND_FARBEN[i] }}>{r.name}:</b> {zahl(v)}</div> : null;
      })}
    </div>
  );
}

export function AuslandWidget({ d }: { d: AuslandDaten }) {
  const kacheln = [
    { label: "Heute", n: d.heute?.n ?? null, umsatz: d.heute?.umsatz ?? null, vorN: null as number | null, unter: d.heute ? (d.heute.laender.join(", ") || "noch keine") : "Shopify nicht erreichbar" },
    { label: "Diese Woche", n: d.woche.n, umsatz: d.woche.umsatz, vorN: d.woche.vorN, unter: `Vorwoche bis zum selben Tag: ${zahl(d.woche.vorN)}` },
    { label: "28 Tage", n: d.d28.n, umsatz: d.d28.umsatz, vorN: d.d28.vorN, unter: `28 Tage davor: ${zahl(d.d28.vorN)}` },
  ];
  const max = Math.max(...d.laender.map((l) => Math.max(l.n, l.vorN)), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {kacheln.map((k, i) => (
          <div key={k.label} className="ck-kachel" style={{ flex: "1 1 150px", ...(i === 1 ? { background: "linear-gradient(135deg, #0ea5e9, #6cc8f5)", color: "#fff" } : {}) }}>
            <div style={{ fontSize: 11.5, fontWeight: 500, opacity: i === 1 ? 0.92 : undefined }} className={i === 1 ? undefined : "ck-dim"}>{k.label}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap", marginTop: 2 }}>
              {k.n != null ? <Zahl wert={k.n} className="ck-gross" /> : <span className="ck-gross">–</span>}
              {k.umsatz != null && <span className="ck-mono" style={{ fontSize: 13, fontWeight: 650, opacity: 0.9 }}>{eur(k.umsatz)}</span>}
              {k.vorN != null && k.n != null && <span style={i === 1 ? { background: "#fff", borderRadius: 999 } : undefined}><Delta neu={k.n} alt={k.vorN} /></span>}
            </div>
            <div style={{ fontSize: 11.5, marginTop: 2, opacity: i === 1 ? 0.92 : undefined, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} className={i === 1 ? undefined : "ck-matt"} title={k.unter}>{k.unter}</div>
          </div>
        ))}
        <div className="ck-kachel" style={{ flex: "1 1 150px", display: "flex", alignItems: "center", gap: 10 }}>
          <Ring anteil={Math.min(100, d.d28.anteil * 5)} groesse={46} dicke={6}><Globe2 size={16} style={{ color: "var(--w)" }} /></Ring>
          <div>
            <div className="ck-etikett">Anteil Ausland</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
              <span className="ck-mittel ck-mono">{zahl(d.d28.anteil, 1)} %</span>
              <Delta neu={d.d28.anteil} alt={d.d28.anteilVor} absolut einheit=" Pkt." />
            </div>
            <div className="ck-matt" style={{ fontSize: 11 }}>aller Bestellungen, 28 Tage</div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 110, display: "flex", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: "3 1 320px", minHeight: 110, display: "flex", flexDirection: "column" }}>
          <div className="ck-etikett" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 2 }}>
            <span>Bestellungen pro Woche</span>
            {d.reihen.map((r, i) => <span key={r.code} style={{ display: "inline-flex", gap: 5, alignItems: "center" }}><i className="ck-legende" style={{ background: LAND_FARBEN[i] }} />{r.name}</span>)}
          </div>
          <div style={{ flex: 1, minHeight: 80 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.wochen} margin={{ top: 6, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={8} />
                <YAxis width={26} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip cursor={{ fill: "rgba(14,165,233,0.08)" }} content={<AuslandTipp reihen={d.reihen} />} />
                {d.reihen.map((r, i) => <Bar key={r.code} dataKey={r.code} stackId="a" fill={LAND_FARBEN[i]} radius={i === d.reihen.length - 1 ? [4, 4, 0, 0] : 0} animationDuration={900} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div style={{ flex: "2 1 220px", display: "grid", gap: 7, alignContent: "start" }}>
          <div className="ck-etikett">Länder, 28 Tage (grau = 28 Tage davor)</div>
          {!d.laender.length && <Hinweis>In den letzten 8 Wochen keine Auslandsbestellung.</Hinweis>}
          {d.laender.slice(0, 6).map((l) => (
            <div key={l.code}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5 }}>
                <span style={{ fontSize: 16, lineHeight: 1 }}>{flagge(l.code)}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
                <Delta neu={l.n} alt={l.vorN} />
                <b className="ck-mono" style={{ whiteSpace: "nowrap" }}>{zahl(l.n)}</b>
                <span className="ck-mono ck-dim" style={{ whiteSpace: "nowrap", minWidth: 58, textAlign: "right" }}>{kurzEur(l.umsatz)}</span>
              </div>
              <div style={{ display: "grid", gap: 2, marginTop: 3 }}>
                <Balken anteil={(l.n / max) * 100} />
                <div className="ck-balken" style={{ height: 4 }}><i style={{ width: `${(l.vorN / max) * 100}%`, ["--ck-b1" as string]: "#b9bdd0", ["--ck-b2" as string]: "#b9bdd0" }} /></div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span className="ck-matt" style={{ fontSize: 11 }}>Nach Lieferland, ohne Stornos{d.standBis ? ` · bis ${tagMonat(d.standBis)} aus der Nachtsynchronisation, heute live` : ""}</span>
        <Mehr href="/pack/kunden">Kundenanalyse</Mehr>
      </div>
    </div>
  );
}

// ── Instagram-Anfragen (DMs) ───────────────────────────────────────────────

const KATEGORIE_NAME: Record<string, string> = {
  availability: "Verfügbarkeit", pricing: "Preis", color_advice: "Farbberatung", appointment: "Termin",
  complaint: "Reklamation", order_status: "Bestellstatus", gewerbe: "Gewerbe", partnership: "Kooperation",
  models: "Modelle", general: "Sonstiges",
};
const WOCHENTAG = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function AnfrageTipp({ active, payload, wochen }: { active?: boolean; payload?: Array<{ payload: { tag: string; n: number; vor: number | null; vj: number | null } }>; wochen: boolean }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="ck-tipp">
      <div style={{ fontWeight: 650, marginBottom: 3 }}>{wochen ? `Woche ab ${tagMonat(p.tag)}` : `${WOCHENTAG[(new Date(`${p.tag}T12:00:00Z`).getUTCDay() + 6) % 7]}, ${tagMonat(p.tag)}`}</div>
      <div><b style={{ color: "#c13584" }}>{zahl(p.n)}</b> Gespräche</div>
      {p.vor != null && <div style={{ color: "#666c8c" }}>Zeitraum davor: {zahl(p.vor)}</div>}
      {p.vj != null && <div style={{ color: "#666c8c" }}>Vorjahr: {zahl(p.vj)}</div>}
    </div>
  );
}

export function IgAnfragenWidget({ d }: { d: IgAnfragenDaten }) {
  const [n, setN] = useState<7 | 30 | 90>(30);
  const p = d.perioden.find((x) => x.tage === n) ?? d.perioden[0];
  // Diagramm: Tage (7/30) bzw. Wochen (90); "davor" und "Vorjahr" an derselben Position
  const wochen = n === 90;
  const reihe = (() => {
    const len = d.tage.length;
    const roh: Array<{ tag: string; n: number; vor: number | null; vj: number | null }> = d.tage.map((t, i) => ({ tag: t.tag, n: t.n, vor: i - n >= 0 ? d.tage[i - n].n : null, vj: d.tageVorjahr[i]?.n ?? null }));
    const fenster = roh.slice(len - n);
    if (!wochen) return fenster;
    const out: typeof fenster = [];
    for (let i = 0; i < fenster.length; i += 7) {
      const w = fenster.slice(i, i + 7);
      const s = (k: "n" | "vor" | "vj") => (w.every((x) => x[k] == null) ? null : w.reduce((a, x) => a + (x[k] ?? 0), 0));
      out.push({ tag: w[0].tag, n: s("n") ?? 0, vor: s("vor"), vj: s("vj") });
    }
    return out;
  })();
  const vjDa = d.tageVorjahr.some((t) => t.n > 0);
  const katMax = Math.max(...p.kategorien.map((k) => k.gespraeche), 1);
  const heatMax = Math.max(...d.stunden.map((s) => s.n), 1);
  const heat = new Map(d.stunden.map((s) => [`${s.wochentag}-${s.stunde}`, s.n]));
  const spitze = [...d.stunden].sort((a, b) => b.n - a.n)[0];

  const vergleiche = [
    { label: `Zeitraum davor`, alt: p.davor.gespraeche },
    ...(p.vorjahr ? [{ label: "Vorjahr", alt: p.vorjahr.gespraeche }] : []),
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="ck-etikett">Kundinnen, die per Instagram-DM geschrieben haben</span>
        <span style={{ display: "inline-flex", gap: 4 }}>
          {([7, 30, 90] as const).map((x) => (
            <button key={x} type="button" className="ck-chip" data-an={n === x} onClick={() => setN(x)} style={{ padding: "3px 10px", fontSize: 11.5 }}>{x} Tage</button>
          ))}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <div className="ck-kachel" style={{ flex: "1 1 130px" }}>
          <div className="ck-etikett">Heute bis jetzt</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" }}>
            <Zahl wert={d.heute.gespraeche} className="ck-gross ck-farbig" />
            <Delta neu={d.heute.gespraeche} alt={d.vorwoche.gespraeche} />
          </div>
          <div className="ck-matt" style={{ fontSize: 11 }}>letzte Woche bis jetzt: {zahl(d.vorwoche.gespraeche)}</div>
        </div>
        <div style={{ flex: "2 1 240px", borderRadius: 14, padding: "9px 12px", color: "#fff", background: "linear-gradient(135deg, #c13584, #e1306c 55%, #f77737)" }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, opacity: 0.92 }}>Letzte {n} Tage</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <Zahl wert={p.gespraeche} className="ck-gross" />
            <span style={{ fontSize: 12, opacity: 0.92 }}>Gespräche · {zahl(p.nachrichten)} Nachrichten</span>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 3 }}>
            {vergleiche.map((v) => (
              <span key={v.label} style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 11.5 }}>
                <span style={{ background: "#fff", borderRadius: 999 }}><Delta neu={p.gespraeche} alt={v.alt} /></span>
                {v.label} ({zahl(v.alt)})
              </span>
            ))}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 120 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={reihe} margin={{ top: 6, right: 0, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="tag" tickLine={false} axisLine={false} tickFormatter={tagMonat} minTickGap={20} />
            <YAxis width={28} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip cursor={{ fill: "rgba(193,53,132,0.07)" }} content={<AnfrageTipp wochen={wochen} />} />
            <Bar dataKey="n" fill="#c13584" radius={[4, 4, 0, 0]} animationDuration={800} />
            <Line type="monotone" dataKey="vor" stroke="#9a9fb8" strokeWidth={1.8} dot={false} animationDuration={1000} />
            {vjDa && <Line type="monotone" dataKey="vj" stroke="#f77737" strokeWidth={1.8} strokeDasharray="4 3" dot={false} animationDuration={1000} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <span className="ck-etikett" style={{ display: "inline-flex", gap: 12, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}><i className="ck-legende" style={{ background: "#c13584" }} />{wochen ? "je Woche" : "je Tag"}</span>
        <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}><i className="ck-legende" style={{ background: "#9a9fb8", height: 3 }} />Zeitraum davor</span>
        {vjDa && <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}><i className="ck-legende" style={{ background: "#f77737", height: 3 }} />Vorjahr</span>}
      </span>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {p.kategorien.length > 0 && (
          <div style={{ flex: "1 1 200px", display: "grid", gap: 4, alignContent: "start" }}>
            <div className="ck-etikett">Worum es ging</div>
            {p.kategorien.slice(0, 5).map((k) => (
              <div key={k.kategorie}>
                <div className="ck-zeile" style={{ padding: "0 0 2px", fontSize: 12 }}>
                  <span>{KATEGORIE_NAME[k.kategorie] ?? k.kategorie}</span><span className="ck-mono">{zahl(k.gespraeche)}</span>
                </div>
                <Balken anteil={(k.gespraeche / katMax) * 100} />
              </div>
            ))}
          </div>
        )}
        {d.stunden.length > 0 && (
          <div style={{ flex: "1 1 220px", display: "grid", gap: 3, alignContent: "start" }}>
            <div className="ck-etikett">Wann geschrieben wird (30 Tage){spitze ? ` · am meisten ${WOCHENTAG[spitze.wochentag - 1]} ${spitze.stunde} Uhr` : ""}</div>
            {WOCHENTAG.map((w, i) => (
              <div key={w} style={{ display: "flex", gap: 1.5, alignItems: "center" }}>
                <span className="ck-matt" style={{ fontSize: 9.5, width: 16 }}>{w}</span>
                {Array.from({ length: 24 }, (_, h) => {
                  const v = heat.get(`${i + 1}-${h}`) ?? 0;
                  return <i key={h} title={`${w} ${h}–${h + 1} Uhr: ${zahl(v)} Nachrichten`} style={{ flex: 1, height: 9, borderRadius: 2, background: "#c13584", opacity: v ? 0.12 + 0.88 * (v / heatMax) : 0.05 }} />;
                })}
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", paddingLeft: 18 }} className="ck-matt">
              {[0, 6, 12, 18, 23].map((h) => <span key={h} style={{ fontSize: 9 }}>{h}</span>)}
            </div>
          </div>
        )}
      </div>
      <span className="ck-matt" style={{ fontSize: 11 }}>Gespräch = Unterhaltung, in der die Kundin im Zeitraum geschrieben hat · vor dem Chatbot (Mai 2026) aus dem Instagram-Archiv</span>
    </div>
  );
}

// ── Werbung (Meta / Google) ──────────────────────────────────────────────────

function WerbeTipp({ active, payload }: { active?: boolean; payload?: Array<{ payload: { datum: string; meta: number; google: number; umsatz: number } }> }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="ck-tipp">
      <div style={{ fontWeight: 650, marginBottom: 3 }}>{tagMonat(p.datum)}{p.datum.slice(0, 4)}</div>
      <div><b style={{ color: "#1877f2" }}>Meta:</b> {eur(p.meta)}</div>
      {p.google > 0 && <div><b style={{ color: "#34a853" }}>Google:</b> {eur(p.google)}</div>}
      <div style={{ color: "#666c8c" }}>Shop-Umsatz: {eur(p.umsatz)}</div>
    </div>
  );
}

export function WerbungWidget({ d }: { d: WerbungDaten }) {
  const heute = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
  const verzug = d.metaStand ? Math.round((Date.parse(`${heute}T12:00:00Z`) - Date.parse(`${d.metaStand}T12:00:00Z`)) / 86_400_000) : null;
  const kosten7 = d.meta7 + d.google7;
  const quote = d.umsatz7 > 0 ? (kosten7 / d.umsatz7) * 100 : null;
  const reihe = d.metaStand ? d.tage.filter((t) => t.datum <= d.metaStand!).slice(-28) : d.tage.slice(-28);
  const maxK = Math.max(...d.kampagnen.map((k) => k.kosten), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 10 }}>
      {verzug != null && verzug > 2 && (
        <div style={{ fontSize: 12, padding: "6px 10px", borderRadius: 10, background: "rgba(239,154,12,0.12)", color: "#9a6300" }}>
          Meta-Daten stehen auf {tagMonat(d.metaStand!)} – das Marketing-Projekt hat seit {verzug} Tagen nichts Neues geholt.
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div className="ck-kachel" style={{ borderLeft: "4px solid #1877f2" }}>
          <div className="ck-etikett">Laufende Meta-Kampagnen</div>
          <div className="ck-gross ck-mono" style={{ color: "#1877f2" }}>{zahl(d.kampagnen.length)}</div>
          <div className="ck-matt" style={{ fontSize: 11 }}>Instagram + Facebook, mit Ausgaben in 14 Tagen</div>
        </div>
        <div className="ck-kachel" style={{ borderLeft: "4px solid #34a853" }}>
          <div className="ck-etikett">Google Ads</div>
          {d.googleStand ? (
            <>
              <div className="ck-gross ck-mono" style={{ color: "#34a853" }}>{zahl(d.googleKampagnen.length)}</div>
              <div className="ck-matt" style={{ fontSize: 11 }}>Kampagnen mit Ausgaben in 14 Tagen</div>
            </>
          ) : (
            <>
              <div className="ck-mittel" style={{ color: "#9a9fb8" }}>noch nicht verbunden</div>
              <div className="ck-matt" style={{ fontSize: 11 }}>Das Google-Ads-Skript muss noch im Werbekonto eingerichtet werden</div>
            </>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <div className="ck-etikett">Ausgaben 7 Tage{d.metaStand ? ` bis ${tagMonat(d.metaStand)}` : ""}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
            <Zahl wert={kosten7} format="eur" className="ck-mittel" />
            <Delta neu={kosten7} alt={d.metaVor7 + d.googleVor7} gutWennHoeher={false} />
          </div>
        </div>
        {quote != null && (
          <div title="Werbekosten geteilt durch Shop-Umsatz in denselben 7 Tagen">
            <div className="ck-etikett">Je 100 € Umsatz</div>
            <span className="ck-mittel ck-mono">{zahl(quote, 2)} €</span>
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 90 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={reihe} margin={{ top: 6, right: 0, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="datum" tickLine={false} axisLine={false} tickFormatter={tagMonat} minTickGap={24} />
            <YAxis width={36} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${zahl(v)} €`} />
            <Tooltip cursor={{ fill: "rgba(24,119,242,0.07)" }} content={<WerbeTipp />} />
            <Bar dataKey="meta" stackId="w" fill="#1877f2" animationDuration={800} />
            <Bar dataKey="google" stackId="w" fill="#34a853" radius={[3, 3, 0, 0]} animationDuration={800} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {d.kampagnen.length > 0 && (
        <div style={{ display: "grid", gap: 6 }}>
          <div className="ck-etikett">Kampagnen, 14 Tage</div>
          {d.kampagnen.slice(0, 6).map((k) => (
            <div key={k.name} title={`${k.name} · ${zahl(k.impressionen)} Impressionen · ${zahl(k.reichweite)} erreicht`}>
              <div className="ck-zeile" style={{ padding: "0 0 2px", fontSize: 12 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.name}</span>
                <span className="ck-mono" style={{ whiteSpace: "nowrap" }}>
                  <span className="ck-matt">{zahl(k.klicks)} Klicks{k.klicks ? ` · ${zahl(k.kosten / k.klicks, 2)} €/Klick` : ""} · </span><b>{eur(k.kosten)}</b>
                </span>
              </div>
              <Balken anteil={(k.kosten / maxK) * 100} von="#1877f2" />
            </div>
          ))}
        </div>
      )}
      <span className="ck-matt" style={{ fontSize: 11 }}>Quelle: Marketing-Projekt (marketing.hairvenly.de)</span>
    </div>
  );
}

// ── Instagram ────────────────────────────────────────────────────────────────

const IG_NEU = "#d6249f";
const IG_WEG = "#b8bccd";
const IG_LINIE = "#7c5cff";

function wochenstart(tag: string): string {
  const d = new Date(`${tag}T12:00:00Z`);
  const wt = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (wt === 0 ? -6 : 1 - wt));
  return d.toISOString().slice(0, 10);
}

function IgTipp({ active, payload, wochen }: { active?: boolean; payload?: Array<{ payload: { tag: string; neu: number; weg: number; follower: number | null; offen: boolean } }>; wochen: boolean }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="ck-tipp">
      <div style={{ fontWeight: 650, marginBottom: 3 }}>{wochen ? `Woche ab ${tagMonat(p.tag)}` : `${tagMonat(p.tag)}${p.tag.slice(0, 4)}`}</div>
      {p.offen ? <div style={{ color: "#666c8c" }}>Follower-Zahlen kommen noch von Instagram</div> : (
        <>
          <div><b style={{ color: IG_NEU }}>+{zahl(p.neu)}</b> neu · <b style={{ color: "#8b90a7" }}>−{zahl(-p.weg)}</b> verloren</div>
          <div>Netto <b>{p.neu + p.weg >= 0 ? "+" : ""}{zahl(p.neu + p.weg)}</b></div>
        </>
      )}
      {p.follower != null && <div style={{ color: "#666c8c", marginTop: 2 }}>Stand {zahl(p.follower)} Follower</div>}
    </div>
  );
}

const ALTER = ["13-17", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"];

export function InstagramWidget({ d }: { d: InstagramDaten }) {
  const [ansicht, setAnsicht] = useState<"tag" | "woche">("tag");
  if (!d.tage.length) return <Hinweis>Noch keine Instagram-Zahlen gespeichert – der tägliche Abruf füllt das Fenster.</Hinweis>;

  // Diagramm: Tage (60) oder Wochen (26)
  const daten = (() => {
    if (ansicht === "tag") {
      return d.tage.slice(-60).map((t) => ({ tag: t.tag, neu: t.neu ?? 0, weg: -(t.verloren ?? 0), follower: t.follower, offen: t.neu == null }));
    }
    const m = new Map<string, { tag: string; neu: number; weg: number; follower: number | null; offen: boolean }>();
    for (const t of d.tage) {
      const w = wochenstart(t.tag);
      const e = m.get(w) ?? { tag: w, neu: 0, weg: 0, follower: null, offen: false };
      e.neu += t.neu ?? 0;
      e.weg -= t.verloren ?? 0;
      if (t.follower != null) e.follower = t.follower;
      m.set(w, e);
    }
    return [...m.values()].slice(-26);
  })();
  const fMin = Math.min(...daten.map((x) => x.follower ?? Infinity));
  const fMax = Math.max(...daten.map((x) => x.follower ?? -Infinity));

  const netto7 = d.d7.neu - d.d7.verloren, vorNetto7 = d.d7.vorNeu - d.d7.vorVerloren;
  const netto30 = d.d30.neu - d.d30.verloren, vorNetto30 = d.d30.vorNeu - d.d30.vorVerloren;
  const g = d.demografie?.geschlecht ?? {};
  const gSumme = (g.F ?? 0) + (g.M ?? 0) + (g.U ?? 0);
  const frauen = gSumme ? Math.round(((g.F ?? 0) / gSumme) * 100) : null;
  const alterMax = Math.max(...ALTER.map((a) => d.demografie?.alter?.[a] ?? 0), 1);
  const alterSumme = ALTER.reduce((s, a) => s + (d.demografie?.alter?.[a] ?? 0), 0) || 1;
  const top = (r: Record<string, number> | undefined, n: number) => Object.entries(r ?? {}).sort((a, b) => b[1] - a[1]).slice(0, n);
  const landSumme = Object.values(d.demografie?.land ?? {}).reduce((s, v) => s + v, 0) || 1;
  const onlineMax = Math.max(...Object.values(d.online ?? {}), 1);
  const besteStunden = Object.entries(d.online ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([h]) => Number(h)).sort((a, b) => a - b);

  const kacheln = [
    { label: "Netto 7 Tage", wert: netto7, vor: vorNetto7, unter: `+${zahl(d.d7.neu)} neu · −${zahl(d.d7.verloren)} verloren` },
    { label: "Netto 30 Tage", wert: netto30, vor: vorNetto30, unter: `+${zahl(d.d30.neu)} neu · −${zahl(d.d30.verloren)} verloren` },
    { label: "Reichweite 7 Tage", wert: d.d7.reichweite, vor: d.d7.vorReichweite, unter: `${zahl(d.d7.profil)} Profilaufrufe · ${zahl(d.d7.klicks)} Website-Klicks` },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 170px", borderRadius: 14, padding: "9px 12px", color: "#fff", background: "linear-gradient(135deg, #feda75 -10%, #fa7e1e 18%, #d62976 50%, #962fbf 80%, #4f5bd5 110%)" }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, opacity: 0.92 }}>Follower</div>
          {d.follower != null ? <Zahl wert={d.follower} className="ck-gross" /> : <span className="ck-gross">–</span>}
          <div style={{ fontSize: 11.5, opacity: 0.95 }}>
            {d.follower != null && d.followerVor30 != null ? `${d.follower - d.followerVor30 >= 0 ? "+" : ""}${zahl(d.follower - d.followerVor30)} in 30 Tagen` : "@hairvenly.de"}
          </div>
        </div>
        {kacheln.map((k) => (
          <div key={k.label} className="ck-kachel" style={{ flex: "1 1 160px" }}>
            <div className="ck-etikett">{k.label}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" }}>
              <span className="ck-mittel ck-mono">{k.label.startsWith("Netto") && k.wert > 0 ? "+" : ""}{zahl(k.wert)}</span>
              <Delta neu={k.wert} alt={k.vor} />
            </div>
            <div className="ck-matt" style={{ fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={k.unter}>{k.unter}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", flex: 1, minHeight: 170 }}>
        <div style={{ flex: "3 1 380px", display: "flex", flexDirection: "column", minHeight: 160 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="ck-etikett" style={{ display: "inline-flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}><i className="ck-legende" style={{ background: IG_NEU }} />neu</span>
              <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}><i className="ck-legende" style={{ background: IG_WEG }} />verloren</span>
              <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}><i className="ck-legende" style={{ background: IG_LINIE, height: 3 }} />Follower gesamt</span>
            </span>
            <span style={{ display: "inline-flex", gap: 4 }}>
              {(["tag", "woche"] as const).map((a) => (
                <button key={a} type="button" className="ck-chip" data-an={ansicht === a} onClick={() => setAnsicht(a)} style={{ padding: "3px 10px", fontSize: 11.5 }}>{a === "tag" ? "Tage" : "Wochen"}</button>
              ))}
            </span>
          </div>
          <div style={{ flex: 1, minHeight: 130 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={daten} stackOffset="sign" margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="tag" tickLine={false} axisLine={false} tickFormatter={tagMonat} minTickGap={24} />
                <YAxis yAxisId="z" width={34} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis yAxisId="f" orientation="right" width={50} tickLine={false} axisLine={false} domain={[Math.floor(fMin * 0.998), Math.ceil(fMax * 1.002)]} tickFormatter={(v: number) => zahl(v)} tickCount={4} allowDecimals={false} hide={!Number.isFinite(fMin)} />
                <Tooltip cursor={{ fill: "rgba(214,36,159,0.06)" }} content={<IgTipp wochen={ansicht === "woche"} />} />
                <ReferenceLine yAxisId="z" y={0} stroke="#c9ccda" />
                <Bar yAxisId="z" dataKey="neu" stackId="a" fill={IG_NEU} radius={[3, 3, 0, 0]} animationDuration={800} />
                <Bar yAxisId="z" dataKey="weg" stackId="a" fill={IG_WEG} radius={[3, 3, 0, 0]} animationDuration={800} />
                <Line yAxisId="f" type="monotone" dataKey="follower" stroke={IG_LINIE} strokeWidth={2.4} dot={false} connectNulls animationDuration={1200} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {d.demografie && (
          <div style={{ flex: "2 1 260px", display: "grid", gap: 10, alignContent: "start" }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              {frauen != null && (
                <Ring anteil={frauen} groesse={64} dicke={8} farbe={IG_NEU}>
                  <span style={{ textAlign: "center", lineHeight: 1.05 }}><b className="ck-mono" style={{ fontSize: 14 }}>{frauen} %</b><br /><span style={{ fontSize: 9 }} className="ck-matt">Frauen</span></span>
                </Ring>
              )}
              <div style={{ flex: 1, display: "grid", gap: 3 }}>
                <div className="ck-etikett">Alter</div>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 48 }} role="img" aria-label="Altersverteilung der Follower">
                  {ALTER.map((a) => {
                    const v = d.demografie?.alter?.[a] ?? 0;
                    return (
                      <div key={a} title={`${a}: ${zahl(v)} (${Math.round((v / alterSumme) * 100)} %)`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, height: "100%", justifyContent: "flex-end" }}>
                        <i style={{ display: "block", width: "100%", height: `${Math.max(4, (v / alterMax) * 100)}%`, borderRadius: "3px 3px 1px 1px", background: v === alterMax ? IG_NEU : "color-mix(in srgb, #d6249f 30%, #fff)" }} />
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: 4 }}>{ALTER.map((a) => <span key={a} className="ck-matt" style={{ flex: 1, fontSize: 9, textAlign: "center" }}>{a}</span>)}</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ display: "grid", gap: 3 }}>
                <div className="ck-etikett">Länder</div>
                {top(d.demografie.land, 4).map(([c, v]) => (
                  <div key={c} style={{ display: "flex", gap: 6, fontSize: 12, alignItems: "center" }}>
                    <span>{flagge(c)}</span><span style={{ flex: 1 }}>{c}</span><span className="ck-mono ck-dim">{zahl((v / landSumme) * 100, v / landSumme < 0.1 ? 1 : 0)} %</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
                <div className="ck-etikett">Städte</div>
                {top(d.demografie.stadt, 4).map(([c, v]) => (
                  <div key={c} style={{ display: "flex", gap: 6, fontSize: 12 }} title={c}>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.split(",")[0]}</span><span className="ck-mono ck-dim">{zahl(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {d.online && (
        <div>
          <div className="ck-etikett" style={{ marginBottom: 4 }}>
            Wann deine Follower online sind{besteStunden.length ? ` · am meisten um ${besteStunden.map((h) => `${h} Uhr`).join(", ")}` : ""}
          </div>
          <div style={{ display: "flex", gap: 2 }} role="img" aria-label="Follower online je Stunde">
            {Array.from({ length: 24 }, (_, h) => {
              const v = d.online?.[String(h)] ?? 0;
              return <i key={h} title={`${h}–${h + 1} Uhr: ${zahl(v)} Follower online`} style={{ flex: 1, height: 16, borderRadius: 3, background: IG_NEU, opacity: 0.12 + 0.88 * (v / onlineMax) }} />;
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }} className="ck-matt">
            {[0, 6, 12, 18, 23].map((h) => <span key={h} style={{ fontSize: 9.5 }}>{h} Uhr</span>)}
          </div>
        </div>
      )}

      <span className="ck-matt" style={{ fontSize: 11 }}>
        Instagram liefert neue und verlorene Follower mit 1–2 Tagen Verzug{d.bisAm ? ` · vollständig bis ${tagMonat(d.bisAm)}` : ""} · Altersverteilung und Länder beziehen sich auf alle Follower
      </span>
    </div>
  );
}

// ── Totes Kapital (Ladenhüter) ──────────────────────────────────────────────

export function TotesKapitalWidget({ d }: { d: TotesKapitalDaten }) {
  if (!d.anzahl) return <Hinweis>Aktuell keine Ladenhüter – nichts liegt länger als nötig im Lager.</Hinweis>;
  const max = Math.max(...d.kollektionen.map((k) => k.wertEur), 1);
  const arten = [
    { label: "Tot", info: "kein Verkauf in 90 Tagen", t: d.tot, farbe: "#c2576b" },
    { label: "Fast tot", info: "Lager reicht über 12 Monate", t: d.fastTot, farbe: "#d99a3c" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 10 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <Ring anteil={d.anteilLager} groesse={62} dicke={8}><span className="ck-mono" style={{ fontSize: 13, fontWeight: 750 }}>{zahl(d.anteilLager)}<span style={{ fontSize: 9 }}> %</span></span></Ring>
        <div style={{ flex: 1 }}>
          <div className="ck-etikett">Gebunden in Ladenhütern</div>
          <Zahl wert={d.wertEur} format="eur" className="ck-gross ck-farbig" />
          <div className="ck-matt" style={{ fontSize: 11.5 }}>{zahl(d.kg, 1)} kg · {zahl(d.anzahl)} Produkte · {zahl(d.anteilLager, 1)} % des Lagers</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {arten.map((a) => (
          <div key={a.label} className="ck-kachel" style={{ borderLeft: `4px solid ${a.farbe}` }} title={a.info}>
            <div className="ck-etikett">{a.label} · {zahl(a.t.anzahl)}</div>
            <div className="ck-mittel ck-mono">{kurzEur(a.t.wertEur)}</div>
            <div className="ck-matt" style={{ fontSize: 11 }}>{zahl(a.t.kg, 1)} kg · {a.info}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <div className="ck-etikett">Wo es liegt</div>
        {d.kollektionen.map((k) => (
          <div key={k.name}>
            <div className="ck-zeile" style={{ padding: "0 0 2px" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.name}</span>
              <span className="ck-mono" style={{ whiteSpace: "nowrap" }}><span className="ck-matt">{zahl(k.kg, 1)} kg · </span><b>{kurzEur(k.wertEur)}</b></span>
            </div>
            <Balken anteil={(k.wertEur / max) * 100} />
          </div>
        ))}
      </div>

      {d.produkte.length > 0 && (
        <div style={{ display: "grid", gap: 4 }}>
          <div className="ck-etikett">Größte Einzelposten</div>
          {d.produkte.map((p, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5 }} title={`${p.name} · ${p.kollektion}`}>
              <i className="ck-legende" style={{ background: p.art === "tot" ? "#c2576b" : "#d99a3c", borderRadius: "50%" }} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
              <span className="ck-mono ck-matt" style={{ whiteSpace: "nowrap" }}>{zahl(p.kg, 1)} kg</span>
              <b className="ck-mono" style={{ whiteSpace: "nowrap" }}>{kurzEur(p.wertEur)}</b>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: "auto" }}>
        <span className="ck-matt" style={{ fontSize: 11 }}>Lager × heutiger Verkaufspreis{d.ohnePreis ? ` · ${d.ohnePreis} ohne Preis nicht enthalten` : ""}</span>
        <Mehr href="/stock/deadstock">Ladenhüter</Mehr>
      </div>
    </div>
  );
}

// ── Besucher & Conversion ───────────────────────────────────────────────────

export function BesucherWidget({ d }: { d: BesucherDaten }) {
  if (!d.verbunden) {
    return (
      <div style={{ display: "flex", gap: 12, alignItems: "center", height: "100%" }}>
        <Symbol farbe="#ef9a0c" groesse={48}><Lock size={22} /></Symbol>
        <div style={{ fontSize: 13, lineHeight: 1.45 }}>
          <div style={{ fontWeight: 650 }}>Noch nicht freigeschaltet</div>
          <div className="ck-dim">
            {d.grund === "scope"
              ? "Shopify gibt Besucherzahlen erst heraus, wenn die Dashboard-App dort das Recht „Berichte lesen“ bekommt."
              : d.grund}
          </div>
        </div>
      </div>
    );
  }
  const s = d.sitzungen7 ?? 0;
  const schritte = [
    { label: "Besuche", n: s },
    { label: "In den Warenkorb", n: d.warenkorb7 ?? 0 },
    { label: "Zur Kasse", n: d.checkout7 ?? 0 },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <div className="ck-etikett">Besuche, 7 Tage</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 3, flexWrap: "wrap" }}>
            <Zahl wert={s} className="ck-gross ck-farbig" />
            <Delta neu={s} alt={d.sitzungenVor7} />
          </div>
        </div>
        <div>
          <div className="ck-etikett">Kaufquote</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 3, flexWrap: "wrap" }}>
            <span className="ck-gross ck-mono">{zahl(d.conversion7 ?? 0, 2)} %</span>
            <Delta neu={d.conversion7 ?? 0} alt={d.conversionVor7} absolut einheit=" Pkt." />
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gap: 5 }}>
        {schritte.map((x) => (
          <div key={x.label}>
            <div className="ck-zeile" style={{ padding: "0 0 2px", fontSize: 12 }}>
              <span className="ck-dim">{x.label}</span><span className="ck-mono">{zahl(x.n)}</span>
            </div>
            <Balken anteil={s ? (x.n / s) * 100 : 0} />
          </div>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 24, display: "flex", alignItems: "flex-end" }}>
        <Funke werte={(d.serie ?? []).map((x) => x.n)} hoehe={30} />
      </div>
    </div>
  );
}

// ── Was kommt auf uns zu ────────────────────────────────────────────────────

const AMPEL_TEXT = {
  ok: { text: "Das Konto reicht", Icon: CheckCircle2, farbe: "#0fae7b" },
  warn: { text: "Es wird knapp", Icon: AlertTriangle, farbe: "#ef9a0c" },
  alarm: { text: "Das Konto reicht nicht", Icon: XCircle, farbe: "#ee3f6f" },
} as const;

const GRUPPEN_FARBE: Record<string, string> = {
  steuern: "#ef9a0c", personal: "#7c5cff", fixkosten: "#2f9bff", gebuehren: "#0fb5ba", lieferanten: "#f0508f", einfuhr: "#ff8a5c", sonstiges: "#9a9fb8",
};
const GRUPPEN_KURZ: Record<string, string> = {
  steuern: "Steuern", personal: "Löhne & Sozialabgaben", fixkosten: "Fixkosten", gebuehren: "Gebühren", lieferanten: "Lieferanten", einfuhr: "Einfuhrabgaben", sonstiges: "Übriges",
};

export function PflichtenWidget({ d }: { d: PflichtenDaten }) {
  const a = AMPEL_TEXT[d.ampel];
  const rein = d.verfuegbar + d.einnahmenErwartet;
  const basis = Math.max(rein, d.summe, 1);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, borderRadius: 14, padding: "9px 12px", color: "#fff", background: `linear-gradient(135deg, ${a.farbe}, color-mix(in srgb, ${a.farbe} 68%, #fff))` }}>
        <a.Icon size={24} style={{ flex: "none" }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700 }}>{a.text}</div>
          <div style={{ fontSize: 12, opacity: 0.95 }}>
            {d.ampel === "alarm"
              ? `Am ${tagMonat(d.tiefpunkt.datum)} fehlen ${eur(-d.tiefpunkt.saldo)}`
              : `Tiefster Stand ${eur(d.tiefpunkt.saldo)} am ${tagMonat(d.tiefpunkt.datum)}${d.ampel === "warn" ? ` · Reserve wäre ${kurzEur(d.puffer)}` : ""}`}
          </div>
        </div>
      </div>

      {/* Geld, das da ist und kommt — gegen das, was abgeht */}
      <div style={{ display: "grid", gap: 6 }}>
        <div>
          <div className="ck-zeile" style={{ padding: "0 0 3px" }}><span className="ck-dim" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Konto + Einnahmen, {d.tage} Tage</span><b className="ck-mono" style={{ color: "#0fae7b", whiteSpace: "nowrap" }}>{kurzEur(rein)}</b></div>
          <div style={{ display: "flex", height: 12, borderRadius: 999, overflow: "hidden", background: "rgba(96,84,150,0.1)" }}>
            <i style={{ width: `${(d.verfuegbar / basis) * 100}%`, background: "#0fae7b", display: "block" }} title={`Konto heute ${eur(d.verfuegbar)}`} />
            <i style={{ width: `${(d.einnahmenErwartet / basis) * 100}%`, background: "#7fe0bd", display: "block" }} title={`Erwartete Einnahmen ${eur(d.einnahmenErwartet)}`} />
          </div>
        </div>
        <div>
          <div className="ck-zeile" style={{ padding: "0 0 3px" }}><span className="ck-dim" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Zu zahlen, {d.tage} Tage</span><b className="ck-mono" style={{ color: "#ee3f6f", whiteSpace: "nowrap" }}>{kurzEur(d.summe)}</b></div>
          <div style={{ display: "flex", height: 12, borderRadius: 999, overflow: "hidden", background: "rgba(96,84,150,0.1)" }}>
            {d.posten.map((p) => <i key={p.gruppe} style={{ width: `${(p.betrag / basis) * 100}%`, background: GRUPPEN_FARBE[p.gruppe], display: "block" }} title={`${p.label} ${eur(p.betrag)}`} />)}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ width: 92, height: 92, flex: "none", position: "relative" }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={d.posten} dataKey="betrag" nameKey="label" innerRadius={29} outerRadius={45} paddingAngle={2} stroke="none" animationDuration={1000}>
                {d.posten.map((p) => <Cell key={p.gruppe} fill={GRUPPEN_FARBE[p.gruppe]} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center", pointerEvents: "none" }}>
            <div>
              <div className="ck-mono" style={{ fontSize: 12.5, fontWeight: 750 }}>{kurzEur(d.summe)}</div>
              <div className="ck-matt" style={{ fontSize: 9.5 }}>{d.tage} Tage</div>
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gap: 4, flex: 1, minWidth: 0 }}>
          {d.posten.map((p) => (
            <div key={p.gruppe} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5 }} title={p.label}>
              <i className="ck-legende" style={{ background: GRUPPEN_FARBE[p.gruppe] }} />
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{GRUPPEN_KURZ[p.gruppe]}</span>
              <span className="ck-mono" style={{ fontWeight: 650, whiteSpace: "nowrap" }}>{p.geschaetzt ? "≈ " : ""}{kurzEur(p.betrag)}</span>
            </div>
          ))}
        </div>
      </div>

      {d.termine.length > 0 && (
        <div>
          <div className="ck-etikett" style={{ marginBottom: 5 }}>Nächste größere Zahlungen</div>
          <div style={{ display: "grid", gap: 5 }}>
            {d.termine.slice(0, 5).map((t, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5 }}>
                <span className="ck-marke ck-mono" data-ton="akzent" style={{ minWidth: 46, textAlign: "center" }}>{tagMonat(t.datum)}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.label}>{t.label}</span>
                <span className="ck-mono" style={{ fontWeight: 650, whiteSpace: "nowrap" }}>{t.geschaetzt ? "≈ " : ""}{eur(t.betrag)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span className="ck-matt" style={{ fontSize: 11 }}>≈ Schätzung aus den letzten Monaten</span>
        <Mehr href="/finances/liquiditaet">Vorschau</Mehr>
      </div>
    </div>
  );
}

// ── Liquidität ──────────────────────────────────────────────────────────────

const LIQ_GRUPPEN: Array<{ id: LiqGruppe; name: string; farbe: string }> = [
  { id: "amanda", name: "Amanda", farbe: "#f0508f" },
  { id: "ebru", name: "Ebru", farbe: "#7c5cff" },
  { id: "ust", name: "Umsatzsteuer", farbe: "#ef9a0c" },
  { id: "steuer", name: "Übrige Steuern", farbe: "#b9770a" },
  { id: "einfuhr", name: "Einfuhr (EUSt, Zoll)", farbe: "#0fb5ba" },
];
const LIQ_FARBE = Object.fromEntries(LIQ_GRUPPEN.map((g) => [g.id, g.farbe])) as Record<LiqGruppe, string>;
const LIQ_NAME = Object.fromEntries(LIQ_GRUPPEN.map((g) => [g.id, g.name])) as Record<LiqGruppe, string>;

function LiqTipp({ active, payload, marken }: { active?: boolean; payload?: Array<{ payload: { datum: string; saldo: number } }>; marken: LiquiditaetDaten["marken"] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const heute = marken.filter((m) => m.datum === p.datum);
  return (
    <div className="ck-tipp" style={{ maxWidth: 300 }}>
      <div style={{ fontSize: 11, color: "#666c8c" }}>{tagMonat(p.datum)}{p.datum.slice(0, 4)}</div>
      <div className="ck-mono" style={{ fontWeight: 700, fontSize: 15, color: p.saldo < 0 ? "#ee3f6f" : "#1e2240" }}>{eur(p.saldo)}</div>
      {heute.map((m, i) => (
        <div key={i} style={{ marginTop: 5, display: "flex", gap: 7, alignItems: "flex-start" }}>
          <i style={{ width: 10, height: 10, borderRadius: "50%", background: LIQ_FARBE[m.gruppe], flex: "none", marginTop: 3 }} />
          <div>
            <b>{LIQ_NAME[m.gruppe]}</b> <span className="ck-mono">{m.geschaetzt ? "≈ " : ""}−{eur(Math.abs(m.betrag))}</span>
            <div style={{ color: "#666c8c", fontSize: 11 }}>{m.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Punkt einer Zahlung auf der Kurve; mehrere am selben Tag stapeln sich nach oben. */
function LiqPunkt({ cx, cy, farbe, stufe }: { cx?: number; cy?: number; farbe: string; stufe: number }) {
  if (cx == null || cy == null) return null;
  return <circle cx={cx} cy={cy - stufe * 12} r={5.5} fill={farbe} stroke="#fff" strokeWidth={2} />;
}

const LIQ_TEXT = { ok: "Über der Reserve", warn: "Unter der Reserve", alarm: "Lücke" } as const;

export function LiquiditaetWidget({ d }: { d: LiquiditaetDaten }) {
  const a = AMPEL_TEXT[d.ampel];
  const ende = d.tage[d.tage.length - 1];
  const min = Math.min(0, ...d.tage.map((t) => t.saldo));
  const [aus, setAus] = useState<LiqGruppe[]>([]);
  const saldoAm = new Map(d.tage.map((t) => [t.datum, t.saldo]));
  const stufeAm = new Map<string, number>();
  const punkte = d.marken
    .filter((m) => !aus.includes(m.gruppe) && saldoAm.has(m.datum))
    .map((m) => {
      const stufe = stufeAm.get(m.datum) ?? 0;
      stufeAm.set(m.datum, stufe + 1);
      return { ...m, stufe, saldo: saldoAm.get(m.datum)! };
    });
  const vorhanden = LIQ_GRUPPEN.filter((g) => d.marken.some((m) => m.gruppe === g.id));
  const kacheln = [
    { label: "Heute", wert: d.start, farbe: "#3b82f6" },
    { label: `Tiefpunkt am ${tagMonat(d.tiefpunkt.datum)}`, wert: d.tiefpunkt.saldo, farbe: a.farbe },
    ...(ende ? [{ label: `In ${d.tage.length - 1} Tagen`, wert: ende.saldo, farbe: "#7c5cff" }] : []),
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 10 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "stretch" }}>
        {kacheln.map((k) => (
          <div key={k.label} className="ck-kachel" style={{ borderLeft: `4px solid ${k.farbe}`, minWidth: 128 }}>
            <div className="ck-etikett">{k.label}</div>
            <Zahl wert={k.wert} format="eur" className="ck-mittel" />
          </div>
        ))}
        <div style={{ marginLeft: "auto", alignSelf: "center", display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 650, color: "#fff", background: a.farbe, borderRadius: 999, padding: "7px 14px" }}>
          <a.Icon size={16} /> {LIQ_TEXT[d.ampel]}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 120 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={d.tage} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="ck-liq" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#6d7dff" stopOpacity={0.42} /><stop offset="1" stopColor="#6d7dff" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="ck-liq-linie" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#3b82f6" /><stop offset="1" stopColor="#a65cf5" />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="datum" tickLine={false} axisLine={false} tickFormatter={tagMonat} minTickGap={46} />
            <YAxis width={56} tickLine={false} axisLine={false} domain={[min, "auto"]} tickFormatter={(v: number) => `${Math.round(v / 1000)} T€`} />
            <Tooltip content={<LiqTipp marken={d.marken} />} cursor={{ stroke: "#7c5cff", strokeOpacity: 0.5, strokeDasharray: "3 3" }} />
            <ReferenceLine y={d.puffer} stroke="#ef9a0c" strokeDasharray="5 5" label={{ value: "Reserve", position: "insideTopRight", fill: "#b97400", fontSize: 11 }} />
            {min < 0 && <ReferenceLine y={0} stroke="#ee3f6f" />}
            <Area type="monotone" dataKey="saldo" stroke="url(#ck-liq-linie)" strokeWidth={3} fill="url(#ck-liq)" animationDuration={1400} dot={false} activeDot={{ r: 5, fill: "#7c5cff", stroke: "#fff", strokeWidth: 2 }} />
            <ReferenceDot x={d.tiefpunkt.datum} y={d.tiefpunkt.saldo} r={10} fill="none" stroke={a.farbe} strokeWidth={2} strokeDasharray="3 3" />
            {punkte.map((m) => (
              <ReferenceDot key={`${m.datum}-${m.gruppe}`} x={m.datum} y={m.saldo} r={5.5} shape={(p: { cx?: number; cy?: number }) => <LiqPunkt cx={p.cx} cy={p.cy} farbe={LIQ_FARBE[m.gruppe]} stufe={m.stufe} />} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {vorhanden.map((g) => {
            const an = !aus.includes(g.id);
            return (
              <button key={g.id} type="button" aria-pressed={an} title={an ? `${g.name} ausblenden` : `${g.name} einblenden`}
                onClick={() => setAus(an ? [...aus, g.id] : aus.filter((x) => x !== g.id))}
                style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 11.5, fontWeight: 550, padding: "3px 9px", borderRadius: 999, cursor: "pointer", border: "1px solid var(--ck-linie)", background: an ? "#fff" : "transparent", color: an ? "var(--ck-text)" : "var(--ck-matt)", opacity: an ? 1 : 0.6 }}>
                <i style={{ width: 9, height: 9, borderRadius: "50%", background: an ? g.farbe : "#c9ccda" }} />{g.name}
              </button>
            );
          })}
          {!vorhanden.length && <span className="ck-matt" style={{ fontSize: 11 }}>Keine geplanten Zahlungen im Zeitraum</span>}
        </span>
        <Mehr href="/finances/liquiditaet">Liquiditätsvorschau</Mehr>
      </div>
    </div>
  );
}
