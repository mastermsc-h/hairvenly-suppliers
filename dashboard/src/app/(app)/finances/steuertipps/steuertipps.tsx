"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Calculator, ChevronDown, Info, Lightbulb, PiggyBank, Scale, Trash2 } from "lucide-react";
import { bonusRechnung, ersparnis, grenzsatz } from "@/lib/finanzen/steuertipps";
import type { SteuertippsBasis } from "./page";
import TippsKatalog from "./tipps-katalog";
import Rechtsformen from "./rechtsformen";
import { eur, eurK, Feld, Karte, Zahl } from "./ui";

type Ermittlung = "unklar" | "bilanz" | "euer";

type MassnahmeKey =
  | "bonus" | "it" | "website" | "gwg" | "sachbezug" | "feier" | "haare" | "retouren" | "rueckstellungen" | "ladenhueter" | "wareneinkauf";

type Massnahme = {
  key: MassnahmeKey;
  titel: string;
  fuer: string;
  farbe: string;
  /** true = es fließt echtes Geld ab; false = Buchung ohne (zusätzlichen) Geldabfluss */
  geldfluss: boolean;
  nur?: "bilanz" | "euer";
  /** Steuer nur verschoben (später wieder höher), nicht endgültig gespart */
  verschiebung?: boolean;
  hinweis: string;
};

const MASSNAHMEN: Massnahme[] = [
  { key: "bonus", titel: "Bonus für die Manager", fuer: "Manager + Firma", farbe: "#7c3aed", geldfluss: true, hinweis: "Bonus + Arbeitgeber-Anteil Sozialversicherung sind voll Betriebsausgabe. Bei Bilanz zählt er schon 2026, wenn er bis 31.12. schriftlich zugesagt ist (Rückstellung), auch wenn er erst 2027 ausgezahlt wird." },
  { key: "it", titel: "Computer, iPads, Kassen, Software", fuer: "Firma", farbe: "#2563eb", geldfluss: true, hinweis: "Hardware und Software dürfen mit 1 Jahr Nutzungsdauer abgeschrieben werden → im Anschaffungsjahr komplett absetzbar, egal wie teuer." },
  { key: "website", titel: "Shop/Website programmieren lassen", fuer: "Firma", farbe: "#0891b2", geldfluss: true, hinweis: "Laufende Pflege, Anpassungen, Apps und Agentur-Stunden sind sofort Betriebsausgabe — dafür gilt die Rechnung hier. Eine komplett neu bestellte Website wird meist über ~3 Jahre abgeschrieben (dann zählt 2026 nur ein Drittel)." },
  { key: "gwg", titel: "Einrichtung & Geräte bis 800 € je Stück", fuer: "Firma", farbe: "#0d9488", geldfluss: true, hinweis: "Geringwertige Wirtschaftsgüter (bis 800 € netto pro Stück): sofort voll absetzbar. Föhne, Stühle, Regale, Glätteisen, Spiegel …" },
  { key: "sachbezug", titel: "50-€-Gutscheine für alle Mitarbeiter", fuer: "Mitarbeiter + Firma", farbe: "#16a34a", geldfluss: true, hinweis: "Bis 50 € im Monat pro Mitarbeiter steuer- und sozialversicherungsfrei (Gutschein-/Guthabenkarte, zusätzlich zum Lohn). Für die Firma voll Betriebsausgabe." },
  { key: "feier", titel: "Betriebsfeiern (2 × im Jahr)", fuer: "Mitarbeiter + Firma", farbe: "#65a30d", geldfluss: true, hinweis: "Bis 110 € pro Person und Feier steuerfrei für die Mitarbeiter, für die Firma Betriebsausgabe." },
  { key: "haare", titel: "Kaputte Haare entsorgen (mit Nachweis)", fuer: "Firma", farbe: "#dc2626", geldfluss: false, hinweis: "Die Haare sind schon verloren — es fließt kein neues Geld ab. Die Hochrechnung zählt bisher nur verkaufte kg als Wareneinsatz; verdorbene Ware fehlt dort. Mit Vernichtungsprotokoll mindert sie den Gewinn." },
  { key: "retouren", titel: "Rückstellung für Retouren nach Silvester", fuer: "Firma", farbe: "#ea580c", geldfluss: false, nur: "bilanz", verschiebung: true, hinweis: "Dezember-Bestellungen, die erst im Januar zurückkommen: Der darin steckende Gewinn darf schon 2026 herausgerechnet werden." },
  { key: "rueckstellungen", titel: "Weitere Rückstellungen (Aufbewahrung, Abschluss, Urlaub)", fuer: "Firma", farbe: "#d97706", geldfluss: false, nur: "bilanz", verschiebung: true, hinweis: "Kosten, die 2026 verursacht, aber erst später bezahlt werden. Mindert den Gewinn 2026 ohne Geldabfluss." },
  { key: "ladenhueter", titel: "Ladenhüter abwerten (Inventur)", fuer: "Firma", farbe: "#b45309", geldfluss: false, nur: "bilanz", verschiebung: true, hinweis: "Ware, die nur noch mit Rabatt verkauft werden kann, darf in der Inventur niedriger bewertet werden (Teilwert). Beleg: Sale-Preise, Verkaufszahlen." },
  { key: "wareneinkauf", titel: "Lieferanten vor dem 31.12. bezahlen", fuer: "Firma", farbe: "#475569", geldfluss: true, nur: "euer", verschiebung: true, hinweis: "Nur bei EÜR: Wareneinkauf zählt, wenn er bezahlt wird. Zahlungen an Amanda/Ebru bis 31.12. mindern den Gewinn 2026 — dafür ist 2027 entsprechend höher." },
];

export default function Steuertipps({ basis }: { basis: SteuertippsBasis }) {
  const [gewinn, setGewinn] = useState<number>(basis.gewinnJahr ?? 400_000);
  const [ermittlung, setErmittlung] = useState<Ermittlung>("unklar");
  const [aktiv, setAktiv] = useState<Set<MassnahmeKey>>(new Set(["bonus", "it", "sachbezug", "haare"]));

  // Eingaben je Maßnahme
  const [bonus, setBonus] = useState({ personen: 2, betrag: 10_000, nov: true, dez: true, gehalt: 4_500 });
  const [it, setIt] = useState(8_000);
  const [website, setWebsite] = useState(10_000);
  const [gwg, setGwg] = useState(4_000);
  const [sachbezug, setSachbezug] = useState({ personen: basis.mitarbeiter || 10, monate: 12 });
  const [feier, setFeier] = useState({ personen: basis.mitarbeiter || 10, je: 110, anzahl: 2 });
  const [haare, setHaare] = useState({ kg: 75, eurKg: 1_050 });
  const dezNetto = basis.shopDezVorjahr ? Math.round(basis.shopDezVorjahr / 1.19 / 1000) * 1000 : 100_000;
  const [retouren, setRetouren] = useState({ umsatz: dezNetto, quote: 12, nachStichtag: 50, rohgewinn: 47 });
  const [rst, setRst] = useState({ aufbewahrung: 5_000, abschluss: 8_000, urlaub: 4_000 });
  const [ladenhueter, setLadenhueter] = useState({ bestand: 40_000, abschlag: 30 });
  const [wareneinkauf, setWareneinkauf] = useState(50_000);

  const { hebesatz, freibetrag, jahr } = basis;
  const bonusErg = useMemo(
    () => bonusRechnung({ personen: bonus.personen, betrag: bonus.betrag, monate: [...(bonus.nov ? [11] : []), ...(bonus.dez ? [12] : [])], monatsgehalt: bonus.gehalt, gewinn, hebesatz, freibetrag, jahr }),
    [bonus, gewinn, hebesatz, freibetrag, jahr]
  );

  const aufwand: Record<MassnahmeKey, number> = {
    bonus: bonusErg.aufwand,
    it,
    website,
    gwg,
    sachbezug: sachbezug.personen * 50 * sachbezug.monate,
    feier: feier.personen * feier.je * feier.anzahl,
    haare: haare.kg * haare.eurKg,
    retouren: retouren.umsatz * (retouren.quote / 100) * (retouren.nachStichtag / 100) * (retouren.rohgewinn / 100),
    rueckstellungen: rst.aufbewahrung + rst.abschluss + rst.urlaub,
    ladenhueter: ladenhueter.bestand * (ladenhueter.abschlag / 100),
    wareneinkauf,
  };

  const erlaubt = (m: Massnahme) => !m.nur || ermittlung === "unklar" || m.nur === ermittlung;
  const gewaehlt = MASSNAHMEN.filter((m) => aktiv.has(m.key) && erlaubt(m));
  const summeAufwand = gewaehlt.reduce((s, m) => s + aufwand[m.key], 0);
  const gesamt = ersparnis(gewinn, summeAufwand, hebesatz, freibetrag, jahr);
  const satz = grenzsatz(gewinn, hebesatz, freibetrag, jahr);
  const geldAus = gewaehlt.filter((m) => m.geldfluss).reduce((s, m) => s + aufwand[m.key], 0);

  // Ersparnis je Maßnahme: Gesamtersparnis anteilig nach Aufwand (Tarif ist nicht linear)
  const proMassnahme = gewaehlt.map((m) => {
    const anteil = summeAufwand > 0 ? aufwand[m.key] / summeAufwand : 0;
    const gespart = gesamt.gespart * anteil;
    return { ...m, aufwand: aufwand[m.key], gespart, kosten: m.geldfluss ? aufwand[m.key] - gespart : 0 };
  });

  const vorherNachher = [
    { name: "Ohne Maßnahmen", est: gesamt.vorher.est, gewst: gesamt.vorher.gewst },
    { name: "Mit Maßnahmen", est: gesamt.nachher.est, gewst: gesamt.nachher.gewst },
  ];

  function toggle(k: MassnahmeKey) {
    setAktiv((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
      {/* Kopf */}
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 flex items-center gap-2">
          <Lightbulb size={20} className="text-amber-500" /> Steuertipps
        </h1>
        <p className="text-sm text-neutral-500 mt-1">
          Was ihr absetzen könnt, wem es nützt — und um wie viel Einkommen- und Gewerbesteuer {jahr} dadurch sinkt.
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <AlertTriangle size={16} className="shrink-0 mt-0.5" />
        <div>
          <b>Keine Steuerberatung.</b> Bei über 2 Mio. € Umsatz seid ihr sehr wahrscheinlich ohnehin <b>bilanzierungspflichtig</b> (Kaufmann nach HGB) — dann gelten die „nur Bilanz“-Tipps. Alle Werte sind Schätzungen nach Stand der Recherche (Nov. 2026) — vor der Umsetzung mit dem Steuerberater
          abstimmen. Und: <b>Steuern sparen ist nicht Geld sparen.</b> Wer 10.000 € ausgibt, um ~{Math.round(satz * 100)} % Steuern zu sparen, hat
          trotzdem ~{eur(10_000 * (1 - satz))} weniger. Es lohnt sich nur für Ausgaben, die ihr ohnehin braucht — oder für Buchungen ohne Geldabfluss.
        </div>
      </div>

      {/* Basis */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-blue-800">Gewinn {jahr}</div>
          <input
            type="number"
            value={gewinn}
            onChange={(e) => setGewinn(Number(e.target.value) || 0)}
            className="mt-1 w-full rounded-lg border border-blue-300 bg-white px-2 py-1 text-lg font-bold tabular-nums text-blue-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
          <div className="text-[11px] text-blue-700 mt-1">{basis.gewinnQuelle}</div>
        </div>
        <Zahl label="ESt + Soli + GewSt" wert={eur(gesamt.vorher.gesamt)} ton="red" unter={`ESt ${eurK(gesamt.vorher.est)} · GewSt ${eurK(gesamt.vorher.gewst)}`} />
        <Zahl label="Jeder abgesetzte Euro spart" wert={`${Math.round(satz * 100)} Cent`} ton="emerald" unter="Grenzsteuersatz (ESt 45 % + Soli + GewSt − Anrechnung)" />
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-violet-800">Gewinnermittlung</div>
          <div className="mt-1.5 flex gap-1">
            {(["unklar", "bilanz", "euer"] as Ermittlung[]).map((e) => (
              <button
                key={e}
                onClick={() => setErmittlung(e)}
                className={`flex-1 rounded-lg px-2 py-1 text-xs font-medium border ${ermittlung === e ? "bg-violet-700 text-white border-violet-700" : "bg-white text-violet-800 border-violet-300 hover:bg-violet-100"}`}
              >
                {{ unklar: "Unklar", bilanz: "Bilanz", euer: "EÜR" }[e]}
              </button>
            ))}
          </div>
          <div className="text-[11px] text-violet-700 mt-1">Manche Tipps gehen nur mit Bilanz bzw. nur mit EÜR — beim Steuerberater erfragen.</div>
        </div>
      </div>

      {/* Spar-Rechner */}
      <Karte titel="Spar-Rechner — Maßnahmen an- und abwählen" ton="emerald" icon={<Calculator size={16} />}>
        <div className="grid lg:grid-cols-[1fr_380px] gap-6">
          <div className="space-y-2">
            {MASSNAHMEN.map((m) => {
              const an = aktiv.has(m.key);
              const ok = erlaubt(m);
              return (
                <div key={m.key} className={`rounded-xl border transition-colors ${an && ok ? "border-neutral-300 bg-white shadow-sm" : "border-neutral-200 bg-neutral-50"} ${ok ? "" : "opacity-50"}`}>
                  <button onClick={() => ok && toggle(m.key)} className="w-full flex items-center gap-3 px-3 py-2 text-left" disabled={!ok}>
                    <span className={`h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center ${an && ok ? "border-transparent" : "border-neutral-300 bg-white"}`} style={an && ok ? { background: m.farbe } : undefined}>
                      {an && ok && <span className="text-white text-[10px] leading-none">✓</span>}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-neutral-900">{m.titel}</span>
                      <span className="ml-2 text-[11px] text-neutral-500">{m.fuer}</span>
                      {m.nur && <span className="ml-2 text-[10px] font-semibold rounded px-1.5 py-0.5 bg-violet-100 text-violet-800">nur {m.nur === "bilanz" ? "Bilanz" : "EÜR"}</span>}
                      {!m.geldfluss && <span className="ml-1 text-[10px] font-semibold rounded px-1.5 py-0.5 bg-emerald-100 text-emerald-800">kein Geldabfluss</span>}
                      {m.verschiebung && <span className="ml-1 text-[10px] font-semibold rounded px-1.5 py-0.5 bg-amber-100 text-amber-800">verschiebt Steuer</span>}
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-neutral-700">{eur(aufwand[m.key])}</span>
                  </button>
                  {an && ok && (
                    <div className="px-3 pb-3 pl-10 space-y-2">
                      <Eingaben k={m.key} {...{ bonus, setBonus, it, setIt, website, setWebsite, gwg, setGwg, sachbezug, setSachbezug, feier, setFeier, haare, setHaare, retouren, setRetouren, rst, setRst, ladenhueter, setLadenhueter, wareneinkauf, setWareneinkauf }} />
                      <p className="text-xs text-neutral-500">{m.hinweis}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Ergebnis */}
          <div className="space-y-4 lg:sticky lg:top-4 self-start">
            <div className="rounded-2xl bg-emerald-600 text-white p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-emerald-100">Steuer sinkt um</div>
              <div className="text-3xl font-bold tabular-nums mt-1">{eur(gesamt.gespart)}</div>
              <div className="text-xs text-emerald-100 mt-1">
                ESt + Soli −{eurK(gesamt.gespartEst)} · GewSt −{eurK(gesamt.gespartGewst)} · bei {eur(summeAufwand)} zusätzlichem Abzug
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-xl bg-neutral-50 border border-neutral-200 p-2">
                <div className="text-[11px] uppercase tracking-wide text-neutral-500 font-semibold">Echte Ausgaben</div>
                <div className="font-bold tabular-nums">{eur(geldAus)}</div>
              </div>
              <div className="rounded-xl bg-neutral-50 border border-neutral-200 p-2">
                <div className="text-[11px] uppercase tracking-wide text-neutral-500 font-semibold">Kostet netto</div>
                <div className="font-bold tabular-nums">{eur(Math.max(0, geldAus - proMassnahme.filter((m) => m.geldfluss).reduce((s, m) => s + m.gespart, 0)))}</div>
              </div>
            </div>
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={vorherNachher} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e5" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => eurK(v)} tick={{ fontSize: 11 }} width={52} />
                  <Tooltip formatter={(v) => eur(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="est" name="ESt + Soli" stackId="s" fill="#ef4444" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="gewst" name="Gewerbesteuer" stackId="s" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {proMassnahme.length > 0 && (
          <div className="mt-6">
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">Je Maßnahme: was die Steuer übernimmt und was ihr selbst tragt</div>
            <div style={{ height: 44 + proMassnahme.length * 34 }}>
              <ResponsiveContainer>
                <BarChart data={proMassnahme} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e5e5" />
                  <XAxis type="number" tickFormatter={(v) => eurK(v)} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="titel" width={230} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v, n) => [eur(Number(v)), n]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="gespart" name="Steuerersparnis" stackId="a" fill="#16a34a">
                    {proMassnahme.map((m) => <Cell key={m.key} fill="#16a34a" />)}
                  </Bar>
                  <Bar dataKey="kosten" name="Eigene Kosten (nach Steuer)" stackId="a" fill="#a3a3a3" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-neutral-500 mt-2">
              Grün = Steuer, die ihr spart. Grau = was die Maßnahme euch nach Steuer wirklich kostet. Ohne Grau (kein Geldabfluss) ist es reine Ersparnis — bei
              „verschiebt Steuer“ allerdings nur bis zum nächsten Jahr.
            </p>
          </div>
        )}
      </Karte>

      {/* Bonus im Detail */}
      <Karte titel={`Beispiel: ${bonus.personen} Manager × ${eur(bonus.betrag)} Bonus${bonus.nov && bonus.dez ? " im November und Dezember" : bonus.nov ? " im November" : bonus.dez ? " im Dezember" : ""}`} ton="violet" icon={<PiggyBank size={16} />}>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-4">
            <div className="text-xs font-bold uppercase tracking-wide text-violet-800 mb-2">Für die Firma (Inhaber)</div>
            <Zeile l="Bonus gesamt" w={eur(bonusErg.bonusGesamt)} />
            <Zeile l="+ Arbeitgeber-Anteil Sozialversicherung" w={eur(bonusErg.agSv)} />
            <Zeile l="= absetzbar als Betriebsausgabe" w={eur(bonusErg.aufwand)} fett />
            <Zeile l="− ESt + GewSt, die du dadurch sparst" w={`−${eur(bonusErg.steuerGespart)}`} gruen />
            <Zeile l="= kostet dich wirklich" w={eur(bonusErg.nettoKostenFirma)} fett />
          </div>
          <div className="rounded-xl border border-neutral-200 p-4">
            <div className="text-xs font-bold uppercase tracking-wide text-neutral-700 mb-2">Für jeden Manager (Steuerklasse I, geschätzt)</div>
            <Zeile l="Bonus brutto" w={eur(bonusErg.bonusGesamt / Math.max(1, bonusErg.personen))} />
            <Zeile l="− Lohnsteuer + Soli" w={`−${eur(bonusErg.abzuegeJePerson.lst)}`} rot />
            <Zeile l="− Sozialversicherung (Arbeitnehmer)" w={`−${eur(bonusErg.abzuegeJePerson.sv)}`} rot />
            <Zeile l="= kommt netto an" w={eur(bonusErg.nettoJePerson)} fett />
            <p className="text-xs text-neutral-500 mt-2">
              Liegt das Monatsgehalt über 5.812,50 € (Grenze Kranken-/Pflegeversicherung), fallen auf den Bonus kaum KV-Beiträge an. Weniger Abzüge:
              einen Teil steuerfrei geben (siehe Mitarbeiter-Tipps unten, z. B. betriebliche Altersvorsorge bis 8.112 €/Jahr steuerfrei).
            </p>
          </div>
        </div>
        <details className="mt-4 group">
          <summary className="cursor-pointer text-sm font-medium text-violet-800 flex items-center gap-1">
            <ChevronDown size={14} className="group-open:rotate-180 transition-transform" /> Was genau ist absetzbar? Und wann?
          </summary>
          <ul className="mt-2 text-sm text-neutral-700 space-y-1.5 list-disc pl-5">
            <li><b>Absetzbar:</b> der volle Bonus (brutto) + der Arbeitgeber-Anteil zur Sozialversicherung + Umlagen. Lohnsteuer und Arbeitnehmer-SV stecken im Brutto — das zahlt der Manager.</li>
            <li><b>Zeitpunkt EÜR:</b> zählt im Jahr der Auszahlung. Bonus im Dezember 2026 ausgezahlt → Gewinn 2026 sinkt.</li>
            <li><b>Zeitpunkt Bilanz:</b> zählt im Jahr, für das er geschuldet ist. Schriftliche Zusage bis 31.12.2026 (z. B. „Bonus für 2026, zahlbar im Januar“) → Rückstellung, Gewinn 2026 sinkt, Geld fließt erst 2027.</li>
            <li><b>Angemessen sein:</b> Boni an fremde Angestellte sind unproblematisch. Bei Angehörigen (Ehepartner, Kinder) prüft das Finanzamt, ob Fremde dasselbe bekämen.</li>
            <li><b>Für den Manager:</b> „sonstiger Bezug“ → Lohnsteuer nach der Jahrestabelle, Sozialversicherung nur bis zur anteiligen Jahres-Beitragsbemessungsgrenze.</li>
          </ul>
        </details>
      </Karte>

      <TippsKatalog ermittlung={ermittlung} />

      {/* Rücklagen & Rückstellungen */}
      <Karte titel="Rücklagen und Rückstellungen — was der Steuerberater meint" ton="amber" icon={<Scale size={16} />}>
        <RueckstellungenErklaert gewinn={gewinn} hebesatz={hebesatz} freibetrag={freibetrag} jahr={jahr} />
      </Karte>

      {/* Haare entsorgen */}
      <Karte titel="Kaputte Haare entsorgen — so zählt es steuerlich" ton="red" icon={<Trash2 size={16} />}>
        <HaareEntsorgen kg={haare.kg} eurKg={haare.eurKg} gewinn={gewinn} hebesatz={hebesatz} freibetrag={freibetrag} jahr={jahr} />
      </Karte>

      <Rechtsformen gewinn={gewinn} hebesatz={hebesatz} freibetrag={freibetrag} jahr={jahr} />

      {/* Fragen an den Steuerberater */}
      <Karte titel="Fragen für den nächsten Termin beim Steuerberater" ton="slate" icon={<Info size={16} />}>
        <ol className="text-sm text-neutral-800 space-y-1.5 list-decimal pl-5">
          <li>Ermitteln wir den Gewinn per <b>EÜR oder Bilanz</b>? Bei über 800.000 € Umsatz besteht Buchführungspflicht (HGB bzw. § 141 AO).</li>
          <li>Kommt der <b>höhere Spitzensteuersatz 2027</b> (45 % ab 250.000 €, 47 % ab 280.000 €)? Falls ja: Ausgaben eher ins Jahr 2027 legen, § 34a-Thesaurierung prüfen.</li>
          <li>Sind <b>Salon und Shop zwei Betriebe</b>? (Investitionsabzugsbetrag für den Salon, falls dessen Gewinn unter 200.000 € liegt.)</li>
          <li>Welche <b>Rückstellungen</b> bilden wir zum 31.12.2026 (Retouren, Aufbewahrung, Jahresabschluss, Urlaub, Boni)?</li>
          <li>Wie dokumentieren wir <b>verdorbene/beschädigte Haare</b> und Ladenhüter, damit die Inventur-Abwertung anerkannt wird?</li>
          <li>Lohnen sich <b>Manager-Boni</b> noch 2026 — Auszahlung im Dezember oder Zusage mit Auszahlung im Januar?</li>
          <li>Welche <b>steuerfreien Benefits</b> (50-€-Karte, bAV, Jobrad, Gesundheit) können wir ab Januar über die Lohnabrechnung anbieten?</li>
          <li>Ab welchem Punkt lohnt sich eine <b>GmbH oder GmbH + Holding</b> für uns (Gewinne fürs Lager im Unternehmen lassen)?</li>
          <li>Kaufvertrag Navaseri: als <b>Warenbestand + Inventar</b> gebucht (nicht Firmenwert)? USt auf den Kaufpreis korrekt?</li>
          <li><b>Vorauszahlungen 2027</b> realistisch festsetzen lassen (Nachzahlung 2026 vermeiden bzw. vorbereiten).</li>
        </ol>
      </Karte>
    </div>
  );
}

// ── Eingaben je Maßnahme ───────────────────────────────────────────────────────────────────────

type EingabenProps = {
  k: MassnahmeKey;
  bonus: { personen: number; betrag: number; nov: boolean; dez: boolean; gehalt: number };
  setBonus: (v: EingabenProps["bonus"]) => void;
  it: number; setIt: (v: number) => void;
  website: number; setWebsite: (v: number) => void;
  gwg: number; setGwg: (v: number) => void;
  sachbezug: { personen: number; monate: number }; setSachbezug: (v: EingabenProps["sachbezug"]) => void;
  feier: { personen: number; je: number; anzahl: number }; setFeier: (v: EingabenProps["feier"]) => void;
  haare: { kg: number; eurKg: number }; setHaare: (v: EingabenProps["haare"]) => void;
  retouren: { umsatz: number; quote: number; nachStichtag: number; rohgewinn: number }; setRetouren: (v: EingabenProps["retouren"]) => void;
  rst: { aufbewahrung: number; abschluss: number; urlaub: number }; setRst: (v: EingabenProps["rst"]) => void;
  ladenhueter: { bestand: number; abschlag: number }; setLadenhueter: (v: EingabenProps["ladenhueter"]) => void;
  wareneinkauf: number; setWareneinkauf: (v: number) => void;
};

function Eingaben(p: EingabenProps) {
  const wrap = (children: React.ReactNode) => <div className="flex flex-wrap gap-3">{children}</div>;
  switch (p.k) {
    case "bonus":
      return wrap(
        <>
          <Feld label="Personen" wert={p.bonus.personen} set={(v) => p.setBonus({ ...p.bonus, personen: v })} breite="w-16" />
          <Feld label="Betrag je Zahlung (€)" wert={p.bonus.betrag} set={(v) => p.setBonus({ ...p.bonus, betrag: v })} schritt={1000} />
          <Feld label="Monatsgehalt brutto (€)" wert={p.bonus.gehalt} set={(v) => p.setBonus({ ...p.bonus, gehalt: v })} schritt={250} />
          <label className="flex items-end gap-3 pb-1.5 text-sm">
            <span className="flex items-center gap-1"><input type="checkbox" checked={p.bonus.nov} onChange={(e) => p.setBonus({ ...p.bonus, nov: e.target.checked })} /> Nov</span>
            <span className="flex items-center gap-1"><input type="checkbox" checked={p.bonus.dez} onChange={(e) => p.setBonus({ ...p.bonus, dez: e.target.checked })} /> Dez</span>
          </label>
        </>
      );
    case "it":
      return wrap(<Feld label="Betrag netto (€)" wert={p.it} set={p.setIt} schritt={500} />);
    case "website":
      return wrap(<Feld label="Betrag netto (€)" wert={p.website} set={p.setWebsite} schritt={500} />);
    case "gwg":
      return wrap(<Feld label="Betrag netto (€)" wert={p.gwg} set={p.setGwg} schritt={250} />);
    case "sachbezug":
      return wrap(
        <>
          <Feld label="Mitarbeiter" wert={p.sachbezug.personen} set={(v) => p.setSachbezug({ ...p.sachbezug, personen: v })} breite="w-16" />
          <Feld label="Monate" wert={p.sachbezug.monate} set={(v) => p.setSachbezug({ ...p.sachbezug, monate: Math.min(12, v) })} breite="w-16" />
          <span className="self-end pb-1.5 text-xs text-neutral-500">à 50 €</span>
        </>
      );
    case "feier":
      return wrap(
        <>
          <Feld label="Personen" wert={p.feier.personen} set={(v) => p.setFeier({ ...p.feier, personen: v })} breite="w-16" />
          <Feld label="€ je Person" wert={p.feier.je} set={(v) => p.setFeier({ ...p.feier, je: v })} breite="w-20" />
          <Feld label="Feiern" wert={p.feier.anzahl} set={(v) => p.setFeier({ ...p.feier, anzahl: v })} breite="w-16" />
        </>
      );
    case "haare":
      return wrap(
        <>
          <Feld label="kg pro Jahr" wert={p.haare.kg} set={(v) => p.setHaare({ ...p.haare, kg: v })} breite="w-20" />
          <Feld label="Einkauf €/kg (inkl. Zoll)" wert={p.haare.eurKg} set={(v) => p.setHaare({ ...p.haare, eurKg: v })} schritt={50} />
        </>
      );
    case "retouren":
      return wrap(
        <>
          <Feld label="Dez.-Umsatz netto (€)" wert={p.retouren.umsatz} set={(v) => p.setRetouren({ ...p.retouren, umsatz: v })} schritt={5000} />
          <Feld label="Retourenquote %" wert={p.retouren.quote} set={(v) => p.setRetouren({ ...p.retouren, quote: v })} breite="w-16" />
          <Feld label="davon nach 31.12. %" wert={p.retouren.nachStichtag} set={(v) => p.setRetouren({ ...p.retouren, nachStichtag: v })} breite="w-16" />
          <Feld label="Rohgewinn-Anteil %" wert={p.retouren.rohgewinn} set={(v) => p.setRetouren({ ...p.retouren, rohgewinn: v })} breite="w-16" />
        </>
      );
    case "rueckstellungen":
      return wrap(
        <>
          <Feld label="Aufbewahrung (€)" wert={p.rst.aufbewahrung} set={(v) => p.setRst({ ...p.rst, aufbewahrung: v })} schritt={500} />
          <Feld label="Jahresabschluss/Erklärung (€)" wert={p.rst.abschluss} set={(v) => p.setRst({ ...p.rst, abschluss: v })} schritt={500} />
          <Feld label="Resturlaub (€)" wert={p.rst.urlaub} set={(v) => p.setRst({ ...p.rst, urlaub: v })} schritt={500} />
        </>
      );
    case "ladenhueter":
      return wrap(
        <>
          <Feld label="Ladenhüter-Bestand zum EK (€)" wert={p.ladenhueter.bestand} set={(v) => p.setLadenhueter({ ...p.ladenhueter, bestand: v })} schritt={5000} />
          <Feld label="Abschlag %" wert={p.ladenhueter.abschlag} set={(v) => p.setLadenhueter({ ...p.ladenhueter, abschlag: v })} breite="w-16" />
        </>
      );
    case "wareneinkauf":
      return wrap(<Feld label="Zahlung bis 31.12. (€)" wert={p.wareneinkauf} set={p.setWareneinkauf} schritt={5000} />);
  }
}

function Zeile({ l, w, fett, gruen, rot }: { l: string; w: string; fett?: boolean; gruen?: boolean; rot?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 py-1 text-sm ${fett ? "font-bold border-t border-neutral-200 mt-1 pt-1.5" : ""}`}>
      <span className="text-neutral-700">{l}</span>
      <span className={`tabular-nums ${gruen ? "text-emerald-700 font-semibold" : rot ? "text-red-700" : "text-neutral-900"}`}>{w}</span>
    </div>
  );
}

// ── Rücklagen/Rückstellungen ────────────────────────────────────────────────────────────────────

function RueckstellungenErklaert({ gewinn, hebesatz, freibetrag, jahr }: { gewinn: number; hebesatz: number; freibetrag: number; jahr: number }) {
  const bsp = 30_000;
  const s = ersparnis(gewinn, bsp, hebesatz, freibetrag, jahr).gespart;
  return (
    <div className="space-y-4 text-sm text-neutral-800">
      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
          <div className="font-bold text-amber-900 mb-1">Rückstellung = Schuld, die schon feststeht, aber noch nicht bezahlt ist</div>
          <p>Kosten, die <b>2026 verursacht</b> sind, aber erst 2027 oder später Geld kosten, dürfen schon in die Bilanz 2026. Der Gewinn 2026 sinkt, obwohl noch nichts abgeflossen ist.</p>
          <p className="mt-2 text-xs text-amber-800">Nur bei Bilanz. Bei EÜR gibt es keine Rückstellungen — dort zählt nur, was bezahlt ist.</p>
        </div>
        <div className="rounded-xl border border-neutral-200 p-4">
          <div className="font-bold text-neutral-900 mb-1">Rücklage = Gewinn bewusst „parken“</div>
          <p>Steuerliche Rücklagen sind Sonderregeln für bestimmte Fälle (Verkauf von Grundstücken § 6b, Ersatz nach Schaden/Versicherung). Den bekanntesten Fall — den <b>Investitionsabzugsbetrag</b> (bis 50 % einer geplanten Anschaffung vorab absetzen) — gibt es nur bis <b>200.000 € Gewinn</b>. Mit ~{eurK(gewinn)} Gewinn fällt Hairvenly heraus.</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="py-2 pr-3">Rückstellung</th>
              <th className="py-2 pr-3">Wofür bei Hairvenly</th>
              <th className="py-2">Größenordnung</th>
            </tr>
          </thead>
          <tbody className="[&_td]:py-2 [&_td]:pr-3 [&_tr]:border-b [&_tr]:border-neutral-100 align-top">
            <tr><td className="font-medium">Retouren</td><td>Dezember-Bestellungen (Black-Friday-Nachlauf, Weihnachten), die nach dem 31.12. zurückkommen — der Gewinnanteil daran</td><td>Dez.-Umsatz × Retourenquote × Anteil nach Silvester × Rohgewinn</td></tr>
            <tr><td className="font-medium">Gewährleistung / Reklamationen</td><td>Kostenloser Ersatz oder Erstattung bei Haar-Reklamationen, die 2026-Verkäufe betreffen</td><td>Erfahrungswert: Reklamationskosten der letzten Jahre im Verhältnis zum Umsatz</td></tr>
            <tr><td className="font-medium">Aufbewahrung</td><td>Belege 8 Jahre, Bücher/Abschlüsse 10 Jahre aufbewahren (Raum, Server, DATEV-Archiv)</td><td>einige Tausend € (jährliche Kosten × Restjahre)</td></tr>
            <tr><td className="font-medium">Jahresabschluss + Steuererklärungen 2026</td><td>Steuerberater-Rechnung für 2026, die erst 2027 kommt</td><td>Höhe der letzten Rechnung</td></tr>
            <tr><td className="font-medium">Resturlaub / Überstunden</td><td>Nicht genommener Urlaub 2026 der Mitarbeiter</td><td>Tage × Tageslohn inkl. AG-Anteil</td></tr>
            <tr><td className="font-medium">Boni / Tantiemen</td><td>Für 2026 zugesagte, im Januar ausgezahlte Boni</td><td>zugesagter Betrag + AG-Anteil SV</td></tr>
            <tr><td className="font-medium">Ausstehende Rechnungen</td><td>Leistungen aus 2026 ohne Rechnung (Agentur, Werbung, Fracht)</td><td>tatsächlicher Betrag</td></tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-neutral-600">
        Beispiel: {eur(bsp)} Rückstellungen senken die Steuer {jahr} um ca. <b>{eur(s)}</b>. Das ist meist eine <b>Verschiebung</b>: Im nächsten Jahr wird
        die Rückstellung aufgelöst bzw. verbraucht. Der Vorteil ist Liquidität (Steuer ein Jahr später) — und dauerhaft, wenn jedes Jahr neue Rückstellungen nachkommen.
        Nicht erlaubt: Rückstellungen für „drohende Verluste“ und für künftige laufende Kosten.
      </p>
    </div>
  );
}

// ── Haare entsorgen ─────────────────────────────────────────────────────────────────────────────

function HaareEntsorgen({ kg, eurKg, gewinn, hebesatz, freibetrag, jahr }: { kg: number; eurKg: number; gewinn: number; hebesatz: number; freibetrag: number; jahr: number }) {
  const wert = kg * eurKg;
  const s = ersparnis(gewinn, wert, hebesatz, freibetrag, jahr).gespart;
  return (
    <div className="space-y-4 text-sm text-neutral-800">
      <div className="grid md:grid-cols-3 gap-3">
        <Zahl label={`${kg} kg × ${eur(eurKg)}`} wert={eur(wert)} ton="red" unter="Einkaufswert der kaputten Haare" />
        <Zahl label="Steuerwirkung" wert={`−${eur(s)}`} ton="emerald" unter="wenn der Verlust bisher nicht im Gewinn steckt" />
        <Zahl label="Pro Monat einplanen" wert={`${(kg / 12).toFixed(1)} kg`} ton="slate" unter={`≈ ${eur(wert / 12)} Einkaufswert`} />
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <div className="font-bold mb-1">Wie es steuerlich wirkt</div>
          <ul className="list-disc pl-5 space-y-1">
            <li><b>Bilanz:</b> Was nicht mehr im Lager ist (Inventur 31.12.), ist automatisch Wareneinsatz. Kaputte Ware wird aus dem Bestand ausgebucht — dafür braucht es den Nachweis, sonst rechnet das Finanzamt mit normaler Marge nach.</li>
            <li><b>EÜR:</b> Die Haare wurden schon beim Bezahlen abgesetzt. Kein zusätzlicher Abzug — der Nachweis ist trotzdem wichtig, damit die niedrigere Marge bei einer Prüfung erklärbar ist.</li>
            <li><b>Umsatzsteuer:</b> Bei Vernichtung bleibt die Vorsteuer/EUSt erhalten (keine Korrektur, keine Entnahme).</li>
            <li><b>Alternative Haarspende</b> (z. B. an einen gemeinnützigen Perücken-Verein): steuerlich etwa gleich wie Vernichten — umsatzsteuerlich zählt der heutige Wert, bei unverkäuflicher Ware nahe 0 €. Plus fürs Image; Spendenbescheinigung nicht zu hoch ansetzen lassen.</li>
            <li><b>Für die Hochrechnung hier:</b> Die Finanzübersicht zählt nur verkaufte kg als Wareneinsatz. Verluste von ~{kg} kg im Jahr fehlen dort — der echte Gewinn ist um ~{eurK(wert)} niedriger.</li>
          </ul>
        </div>
        <div>
          <div className="font-bold mb-1">Nachweis — so wird es anerkannt</div>
          <ol className="list-decimal pl-5 space-y-1">
            <li><b>Laufend sammeln</b>: Reklamationen und Lagerschäden in eine Kiste, je Stück Grund notieren (Bestellnr., Produkt, Farbe, Länge, Gewicht).</li>
            <li><b>Liste mit Einkaufswert</b>: Produkt, Menge (g), Lieferant, EK €/kg — am besten monatlich.</li>
            <li><b>Fotos</b> der Ware (Zustand sichtbar) und der gewogenen Menge.</li>
            <li><b>Vernichtungsprotokoll</b>: Datum, Menge, Wert, Grund, Unterschrift von <b>zwei Personen</b> (z. B. Manager + Mitarbeiterin).</li>
            <li><b>Entsorgungsbeleg</b>: Wiegeschein/Quittung vom Wertstoffhof oder Entsorger (z. B. Gewerbeabfall-Annahme der Bremer Stadtreinigung). Eine Mülldeponie ist nicht nötig — Hauptsache, die Entsorgung ist belegt.</li>
            <li><b>Bestand korrigieren</b>: in Shopify/Lager ausbuchen, damit Inventur und Liste zusammenpassen.</li>
            <li>Alles dem Steuerberater zum Jahresabschluss geben (10 Jahre aufbewahren).</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
