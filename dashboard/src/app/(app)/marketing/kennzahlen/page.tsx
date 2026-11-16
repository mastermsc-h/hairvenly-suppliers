import { Mail, Camera, MessageCircle, Megaphone, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { ladeNewsletter, NEWSLETTER_EREIGNISSE } from "@/lib/newsletter";
import { ladeIgAnfragen, ladeInstagram, ladeWerbung } from "@/lib/cockpit/daten";
import NewsletterChart from "./newsletter-chart";

export const dynamic = "force-dynamic";
export const metadata = { title: "Wichtigste Kennzahlen · Marketing" };

const zahl = (n: number) => new Intl.NumberFormat("de-DE").format(Math.round(n));
const eur = (n: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const MON = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const CARD = "bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm";
const LABEL = "text-xs font-medium text-neutral-600 uppercase tracking-wide";

function Delta({ neu, alt, umkehren = false }: { neu: number; alt: number | null | undefined; umkehren?: boolean }) {
  if (alt == null || alt === 0) return null;
  const d = (neu - alt) / alt;
  const gut = umkehren ? d < 0 : d > 0;
  return <span className={`text-xs font-medium ${Math.abs(d) < 0.005 ? "text-neutral-500" : gut ? "text-emerald-600" : "text-rose-600"}`}>{d > 0 ? "▲" : d < 0 ? "▼" : "•"} {Math.abs(Math.round(d * 100))} %</span>;
}

function Kachel({ icon, label, wert, sub, delta }: { icon: React.ReactNode; label: string; wert: string; sub?: string; delta?: React.ReactNode }) {
  return (
    <div className={CARD}>
      <div className="flex items-center gap-2"><span className="text-neutral-400">{icon}</span><span className={LABEL}>{label}</span></div>
      <div className="mt-1 text-2xl font-semibold text-neutral-900 tabular-nums">{wert}</div>
      <div className="mt-1 flex items-center gap-2 text-xs text-neutral-500 flex-wrap">{delta}{sub && <span>{sub}</span>}</div>
    </div>
  );
}

const sicher = async <T,>(p: Promise<T>): Promise<T | null> => { try { return await p; } catch { return null; } };

export default async function KennzahlenPage() {
  await requireAdmin();
  const [nl, ig, anfr, werb] = await Promise.all([sicher(ladeNewsletter()), sicher(ladeInstagram()), sicher(ladeIgAnfragen()), sicher(ladeWerbung())]);
  const a30 = anfr?.perioden.find((p) => p.tage === 30);
  const monatName = (m: string) => `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Wichtigste Kennzahlen</h1>
        <p className="text-sm text-neutral-500 mt-1">Reichweite und Kundenkontakt auf einen Blick – darunter die Newsletter-Zahlen im Detail.</p>
      </div>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kachel icon={<Mail size={15} />} label="Newsletter-Abonnenten" wert={nl?.bestand ? zahl(nl.bestand.abonniert) : "–"}
          delta={nl ? <Delta neu={nl.d30.neu - nl.d30.abmeldungen} alt={nl.d30.vorNeu - nl.d30.vorAbmeldungen} /> : null}
          sub={nl ? `${nl.d30.neu - nl.d30.abmeldungen >= 0 ? "+" : ""}${zahl(nl.d30.neu - nl.d30.abmeldungen)} netto in 30 Tagen` : undefined} />
        <Kachel icon={<Camera size={15} />} label="Instagram-Follower" wert={ig?.follower != null ? zahl(ig.follower) : "–"}
          delta={ig ? <Delta neu={ig.d30.neu - ig.d30.verloren} alt={ig.d30.vorNeu - ig.d30.vorVerloren} /> : null}
          sub={ig ? `${ig.d30.neu - ig.d30.verloren >= 0 ? "+" : ""}${zahl(ig.d30.neu - ig.d30.verloren)} netto in 30 Tagen` : undefined} />
        <Kachel icon={<MessageCircle size={15} />} label="Instagram-Anfragen" wert={a30 ? zahl(a30.gespraeche) : "–"}
          delta={a30 ? <Delta neu={a30.gespraeche} alt={a30.davor.gespraeche} /> : null} sub="Gespräche in 30 Tagen" />
        <Kachel icon={<Megaphone size={15} />} label="Werbeausgaben (Meta)" wert={werb ? eur(werb.meta7) : "–"}
          delta={werb ? <Delta neu={werb.meta7} alt={werb.metaVor7} umkehren /> : null}
          sub={werb?.metaStand ? `7 Tage bis ${new Date(`${werb.metaStand}T12:00:00Z`).toLocaleDateString("de-DE")}` : undefined} />
      </section>

      <div className="pt-2">
        <h2 className="text-lg font-semibold text-neutral-900 inline-flex items-center gap-2"><Mail size={18} className="text-violet-600" /> Newsletter</h2>
        <p className="text-sm text-neutral-500">Aus Shopify (E-Mail-Marketing-Einwilligung der Kundinnen), täglich aktualisiert.</p>
      </div>

      {!nl?.bestand ? (
        <div className={CARD}>Noch keine Newsletter-Zahlen gespeichert.</div>
      ) : (
        <>
          <section className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <Kachel icon={<CheckCircle2 size={15} />} label="Abonniert" wert={zahl(nl.bestand.abonniert)}
              sub={nl.abonniertVor30 != null ? `vor 30 Tagen ${zahl(nl.abonniertVor30)}` : undefined} />
            <Kachel icon={<Mail size={15} />} label="Neu, 7 Tage" wert={zahl(nl.d7.neu)} delta={<Delta neu={nl.d7.neu} alt={nl.d7.vorNeu} />} sub={`davor ${zahl(nl.d7.vorNeu)}`} />
            <Kachel icon={<Mail size={15} />} label="Neu, 30 Tage" wert={zahl(nl.d30.neu)} delta={<Delta neu={nl.d30.neu} alt={nl.d30.vorNeu} />} sub={`davor ${zahl(nl.d30.vorNeu)}`} />
            <Kachel icon={<AlertTriangle size={15} />} label="Abgemeldet, 30 Tage" wert={zahl(nl.d30.abmeldungen)} delta={<Delta neu={nl.d30.abmeldungen} alt={nl.d30.vorAbmeldungen} umkehren />} sub={`insgesamt ${zahl(nl.bestand.abgemeldet)}`} />
            <Kachel icon={<Info size={15} />} label="Unbestätigt" wert={zahl(nl.bestand.ausstehend)}
              sub={`${zahl(nl.d30.ausstehend)} neu in 30 Tagen${nl.bestaetigt30 != null ? ` · ${String(nl.bestaetigt30).replace(".", ",")} % bestätigt` : ""}`} />
          </section>

          <section className="space-y-2">
            {nl.hinweise.map((h, i) => (
              <div key={i} className={`rounded-xl px-4 py-3 text-sm flex gap-2 items-start ${h.ton === "warn" ? "bg-amber-50 text-amber-900 border border-amber-200" : h.ton === "gut" ? "bg-emerald-50 text-emerald-900 border border-emerald-200" : "bg-sky-50 text-sky-900 border border-sky-200"}`}>
                {h.ton === "warn" ? <AlertTriangle size={16} className="shrink-0 mt-0.5" /> : h.ton === "gut" ? <CheckCircle2 size={16} className="shrink-0 mt-0.5" /> : <Info size={16} className="shrink-0 mt-0.5" />}
                {h.text}
              </div>
            ))}
          </section>

          <section className={CARD}>
            <div className={`${LABEL} mb-3`}>Verlauf</div>
            <NewsletterChart d={nl} ereignisse={NEWSLETTER_EREIGNISSE} />
          </section>

          <section className={CARD}>
            <div className={`${LABEL} mb-3`}>Je Monat</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-neutral-500 border-b border-neutral-200">
                    <th className="py-2 pr-3 font-medium">Monat</th>
                    <th className="py-2 px-3 font-medium text-right">Neu bestätigt</th>
                    <th className="py-2 px-3 font-medium text-right">Unbestätigt</th>
                    <th className="py-2 px-3 font-medium text-right">Abgemeldet</th>
                    <th className="py-2 px-3 font-medium text-right">Netto</th>
                    <th className="py-2 pl-3 font-medium text-right">Abonnenten am Ende</th>
                  </tr>
                </thead>
                <tbody>
                  {[...nl.monate].reverse().map((m) => {
                    const netto = m.neu - m.abmeldungen;
                    return (
                      <tr key={m.monat} className="border-b border-neutral-100 tabular-nums">
                        <td className="py-1.5 pr-3">{monatName(m.monat)}</td>
                        <td className="py-1.5 px-3 text-right">{zahl(m.neu)}</td>
                        <td className="py-1.5 px-3 text-right text-neutral-500">{zahl(m.ausstehend)}</td>
                        <td className="py-1.5 px-3 text-right text-rose-600">{m.abmeldungen ? `−${zahl(m.abmeldungen)}` : "0"}</td>
                        <td className={`py-1.5 px-3 text-right font-medium ${netto >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{netto >= 0 ? "+" : ""}{zahl(netto)}</td>
                        <td className="py-1.5 pl-3 text-right">{m.ende != null ? zahl(m.ende) : "–"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-neutral-500 mt-3">
              Gezählt nach dem Datum der letzten Einwilligungsänderung jeder Kundin: wer sich an- und später wieder abgemeldet hat, steht nur bei den Abmeldungen.
              „Unbestätigt“ = angemeldet, aber den Bestätigungslink (Double-Opt-in) noch nicht geklickt. Abonnenten am Monatsende sind ab heute rückwärts gerechnet.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
