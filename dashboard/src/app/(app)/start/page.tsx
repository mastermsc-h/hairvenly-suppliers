import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireProfile, hasFeature } from "@/lib/auth";
import {
  ladeAusland, ladeBesucher, ladeTotesKapital, ladeChats, ladeEintraege, ladeHy, ladeKampagnen, ladeLayout, ladeLiquiditaet, ladePflichten,
  ladeShopify, ladeSignale, ladeTeam, ladeUmsatz,
} from "@/lib/cockpit/daten";
import { WIDGETS } from "@/lib/cockpit/typen";
import CockpitGrid from "./cockpit-grid";
import { Hinweis, Lade } from "./bausteine";
import { TotesKapitalWidget, AuslandWidget, BesucherWidget, ChatsWidget, HyWidget, LageWidget, LiquiditaetWidget, PflichtenWidget, ShopifyWidget, UmsatzWidget } from "./widgets-zahlen";
import { ladeHalo } from "@/lib/marketing-extern";
import MarketingWidget from "../marketing/marketing-widget";
import { AktionenWidget, AufgabenWidget, IdeenWidget, MeilensteineWidget, NotizenWidget, PfeilerWidget, PhilosophieWidget } from "./widgets-eintraege";

export const dynamic = "force-dynamic";
export const metadata = { title: "Start · Hairvenly" };

/** Lädt die Zahlen eines Widgets; ein Fehler bleibt in diesem einen Widget. */
async function Mit<T>({ lade, children }: { lade: () => Promise<T>; children: (d: T) => React.ReactNode }) {
  let d: T;
  try {
    d = await lade();
  } catch (e) {
    console.warn("[cockpit] Widget:", e instanceof Error ? e.message : e);
    return <Hinweis>Diese Zahlen konnten gerade nicht geladen werden. Beim nächsten Öffnen der Seite wird es erneut versucht.</Hinweis>;
  }
  return <>{children(d)}</>;
}

const warte = (node: React.ReactNode) => <Suspense fallback={<Lade />}>{node}</Suspense>;

export default async function StartPage() {
  const profile = await requireProfile();
  if (profile.role === "supplier") redirect("/");

  const finanzen = hasFeature(profile, "finances");
  const chatbot = hasFeature(profile, "chatbot");
  const istAdmin = profile.role === "admin";
  const erlaubt = WIDGETS.filter((w) => w.feature == null || (w.feature === "finances" ? finanzen : chatbot)).map((w) => w.id as string);

  const [eintraege, team, gespeichert, kampagnen] = await Promise.all([
    ladeEintraege(profile.id),
    ladeTeam(),
    ladeLayout(profile.id),
    ladeKampagnen().catch(() => []),
  ]);

  const inhalte: Record<string, React.ReactNode> = {
    lage: warte(<Mit lade={() => ladeSignale({ finanzen, chatbot })}>{(d) => <LageWidget signale={d} />}</Mit>),
    notizen: <NotizenWidget eintraege={eintraege} />,
    ideen: <IdeenWidget eintraege={eintraege} />,
    aufgaben: <AufgabenWidget eintraege={eintraege} team={team} />,
    meilensteine: <MeilensteineWidget eintraege={eintraege} istAdmin={istAdmin} />,
    pfeiler: <PfeilerWidget eintraege={eintraege} istAdmin={istAdmin} />,
    aktionen: <AktionenWidget eintraege={eintraege} kampagnen={kampagnen} istAdmin={istAdmin} />,
    philosophie: <PhilosophieWidget eintraege={eintraege} istAdmin={istAdmin} />,
  };
  if (chatbot) {
    inhalte.chats = warte(<Mit lade={ladeChats}>{(d) => <ChatsWidget d={d} />}</Mit>);
  }
  if (finanzen) {
    inhalte.umsatz = warte(<Mit lade={ladeUmsatz}>{(d) => <UmsatzWidget d={d} />}</Mit>);
    inhalte.hy = warte(<Mit lade={ladeHy}>{(d) => <HyWidget d={d} />}</Mit>);
    inhalte.shopify = warte(<Mit lade={ladeShopify}>{(d) => <ShopifyWidget d={d} />}</Mit>);
    inhalte.ausland = warte(<Mit lade={ladeAusland}>{(d) => <AuslandWidget d={d} />}</Mit>);
    inhalte.toteskapital = warte(<Mit lade={ladeTotesKapital}>{(d) => <TotesKapitalWidget d={d} />}</Mit>);
    inhalte.besucher = warte(<Mit lade={ladeBesucher}>{(d) => <BesucherWidget d={d} />}</Mit>);
    inhalte.pflichten = warte(<Mit lade={() => ladePflichten(30)}>{(d) => <PflichtenWidget d={d} />}</Mit>);
    inhalte.liquiditaet = warte(<Mit lade={ladeLiquiditaet}>{(d) => <LiquiditaetWidget d={d} />}</Mit>);
    inhalte.marketing = warte(<Mit lade={ladeHalo}>{(d) => <MarketingWidget d={d} />}</Mit>);
  }

  return (
    <CockpitGrid
      name={profile.display_name ?? profile.username ?? "Team"}
      erlaubt={erlaubt}
      gespeichert={gespeichert}
      inhalte={inhalte}
    />
  );
}
