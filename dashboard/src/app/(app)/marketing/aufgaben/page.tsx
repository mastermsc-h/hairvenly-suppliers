import Link from "next/link";
import { ListTodo, ExternalLink, AlertTriangle } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { ladeHalo, dringendeAufgaben, personName, heuteBerlin, type HaloAufgabe } from "@/lib/marketing-extern";
import DringendListe from "../dringend-liste";

export const dynamic = "force-dynamic";

const CARD = "bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm";
const datum = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("de-DE") : "—");
const PRIO_CLS: Record<string, string> = { hoch: "bg-rose-100 text-rose-700", mittel: "bg-amber-100 text-amber-800", niedrig: "bg-neutral-100 text-neutral-600" };
const prioRang = (p: string | null) => (p === "hoch" ? 0 : p === "mittel" ? 1 : 2);

export default async function MarketingAufgabenPage() {
  await requireAdmin();
  let daten;
  try {
    daten = await ladeHalo();
  } catch (e) {
    return (
      <div className="p-4 md:p-8">
        <div className={`${CARD} flex gap-2 text-sm text-rose-700`}><AlertTriangle size={16} /> HALO-Daten konnten nicht geladen werden. {e instanceof Error ? e.message : ""}</div>
      </div>
    );
  }
  const heute = heuteBerlin();
  const offen = daten.aufgaben.filter((a) => a.status === "offen");
  const erledigt = daten.aufgaben.filter((a) => a.status !== "offen");
  const nachPerson = new Map<string, HaloAufgabe[]>();
  for (const a of offen) {
    const k = a.person ?? "—";
    nachPerson.set(k, [...(nachPerson.get(k) ?? []), a]);
  }
  const offeneSchritte = offen.reduce((s, a) => s + a.offene_schritte.length, 0);
  const laufendeKampagnen = daten.kampagnen.filter((k) => k.st !== "abgeschlossen");

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><ListTodo size={22} /> Marketing-Aufgaben</h1>
          <p className="text-sm text-neutral-500">
            Aus HALO, nur lesend, Stand {new Date(daten.stand).toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" })}.
            {" "}Bearbeiten in{" "}
            <a href="https://halo.hairvenly.de" target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-0.5">halo.hairvenly.de <ExternalLink size={11} /></a>
          </p>
        </div>
        <Link href="/marketing" className="text-sm underline text-neutral-600">← Marketing-Zahlen</Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Zahl label="Offene Aufgaben" wert={offen.length} />
        <Zahl label="Offene Schritte" wert={offeneSchritte} />
        <Zahl label="Dringend" wert={dringendeAufgaben(daten, heute).length} />
        <Zahl label="Kampagnen aktiv/geplant" wert={laufendeKampagnen.length} />
      </div>

      <section className={CARD}>
        <h2 className="font-semibold mb-3">Dringend</h2>
        <DringendListe eintraege={dringendeAufgaben(daten, heute)} max={30} />
      </section>

      {[...nachPerson.entries()].map(([p, liste]) => (
        <section key={p} className={CARD}>
          <h2 className="font-semibold mb-3">{personName(p)} <span className="text-neutral-400 font-normal">· {liste.length} offen</span></h2>
          <div className="space-y-3">
            {liste
              .sort((a, b) => prioRang(a.prio) - prioRang(b.prio) || (a.faellig ?? "9").localeCompare(b.faellig ?? "9"))
              .map((a) => <AufgabeKarte key={a.id} a={a} heute={heute} />)}
          </div>
        </section>
      ))}

      {laufendeKampagnen.length > 0 && (
        <section className={CARD}>
          <h2 className="font-semibold mb-3">Kampagnen</h2>
          <ul className="text-sm divide-y divide-neutral-100">
            {laufendeKampagnen.map((k) => (
              <li key={k.id} className="py-2 flex items-center gap-3">
                <span className="font-medium">{k.n}</span>
                <span className="text-xs rounded bg-neutral-100 px-1.5 py-0.5">{k.st}</span>
                <span className="text-xs text-neutral-500">ab {datum(k.von)}{k.bis ? ` bis ${datum(k.bis)}` : ""} · {personName(k.who)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {erledigt.length > 0 && (
        <p className="text-xs text-neutral-400">Außerdem {erledigt.length} erledigte/abgebrochene Aufgaben (ausgeblendet).</p>
      )}
    </div>
  );
}

function Zahl({ label, wert }: { label: string; wert: number }) {
  return (
    <div className={CARD}>
      <div className="text-xs font-medium text-neutral-600 uppercase tracking-wide">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{wert}</div>
    </div>
  );
}

function AufgabeKarte({ a, heute }: { a: HaloAufgabe; heute: string }) {
  const ueberfaellig = a.faellig && a.faellig < heute;
  const anteil = a.schritte_gesamt ? a.schritte_erledigt / a.schritte_gesamt : 0;
  return (
    <details className="rounded-xl border border-neutral-200 px-3 py-2">
      <summary className="cursor-pointer list-none flex flex-wrap items-center gap-2 text-sm">
        {a.prio && <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${PRIO_CLS[a.prio] ?? PRIO_CLS.niedrig}`}>{a.prio}</span>}
        <span className="font-medium text-neutral-900">{a.titel}</span>
        <span className="text-xs text-neutral-500">{a.bereich}</span>
        <span className="ml-auto flex items-center gap-3 text-xs text-neutral-500">
          {a.faellig && <span className={ueberfaellig ? "text-rose-600 font-medium" : ""}>fällig {datum(a.faellig)}</span>}
          <span className="inline-flex items-center gap-1.5">
            <span className="w-16 h-1.5 rounded-full bg-neutral-100 overflow-hidden"><span className="block h-full bg-emerald-500" style={{ width: `${Math.round(anteil * 100)}%` }} /></span>
            {a.schritte_erledigt}/{a.schritte_gesamt}
          </span>
        </span>
      </summary>
      {a.offene_schritte.length > 0 ? (
        <ul className="mt-2 mb-1 space-y-1 text-sm">
          {a.offene_schritte.map((s, i) => (
            <li key={i} className="flex gap-3 text-neutral-700">
              <span className={`w-20 shrink-0 text-xs pt-0.5 ${s.geplant && s.geplant < heute ? "text-rose-600" : "text-neutral-500"}`}>{datum(s.geplant)}</span>
              <span className="flex-1">{s.titel}</span>
              {s.minuten ? <span className="text-xs text-neutral-400">{s.minuten} min</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-neutral-500">Keine offenen Schritte.</p>
      )}
    </details>
  );
}
