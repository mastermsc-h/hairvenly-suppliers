// Hairvenly Welt — Prototyp. Alle Zahlen hier sind BEISPIELZAHLEN, damit man
// die 3D-Ansicht testen kann. Sobald das Konzept steht, werden die Inseln an
// die echten Datenquellen der jeweiligen Bereiche angeschlossen.

export type Status = "ok" | "warn" | "alarm";
export type FlussArt = "ware" | "geld" | "besucher" | "signale";

export interface Kpi {
  label: string;
  wert: string;
  trend?: string;
  gut?: boolean;
}

export interface Vorschlag {
  id: string;
  art: "alarm" | "warn" | "idee";
  titel: string;
  detail: string;
  aktion: string;
}

export interface Insel {
  id: string;
  name: string;
  /** Bestehende Dashboard-Seite. Fehlt sie, ist der Bereich noch nicht gebaut. */
  href?: string;
  status: Status;
  kopf: Kpi;
  kpis: Kpi[];
  vorschlaege: Vorschlag[];
  pos: [number, number, number];
  /** Höhe des Sockels, auf dem die Skulptur steht. */
  hoehe: number;
  /** Eigene Farbe des Bereichs — Symbol, Lichtkante und Beschriftung. */
  farbe: string;
  /** Füllstand des Rings um den Sockel, 0 bis 1. */
  fuellung: number;
}

export interface Fluss {
  id: string;
  von: string;
  nach: string;
  art: FlussArt;
  text: string;
  /** Anzahl Teilchen — steht für die Menge, die gerade fließt. */
  menge: number;
  tempo: number;
}

export const FLUSS_ARTEN: Record<FlussArt, { name: string; farbe: string }> = {
  ware: { name: "Ware", farbe: "#e7c9a0" },
  geld: { name: "Geld", farbe: "#a9e5c9" },
  besucher: { name: "Besucher", farbe: "#f0b4c6" },
  signale: { name: "Nachrichten", farbe: "#b5d0ff" },
};

export const AKZENT = "#e7c9a0";

export const STATUS_FARBE: Record<Status, string> = {
  ok: AKZENT,
  warn: "#f0b45a",
  alarm: "#ff6b81",
};

// Jeder Bereich hat eine eigene Farbe, damit man ihn sofort wiedererkennt.
const BEREICHE: Record<string, { farbe: string; fuellung: number }> = {
  einkauf: { farbe: "#6fd3f2", fuellung: 0.62 },
  lager: { farbe: "#b69cf5", fuellung: 0.38 },
  versand: { farbe: "#f5a25c", fuellung: 0.8 },
  shop: { farbe: "#f77fa6", fuellung: 0.74 },
  marketing: { farbe: "#e06fe6", fuellung: 0.68 },
  content: { farbe: "#4fd6c2", fuellung: 0.66 },
  service: { farbe: "#7b8dfa", fuellung: 0.71 },
  team: { farbe: "#b5df62", fuellung: 0.78 },
  salon: { farbe: "#ff9a85", fuellung: 0.83 },
  finanzen: { farbe: "#57d993", fuellung: 0.86 },
};

const RING_RADIUS = 13;

type InselOhnePos = Omit<Insel, "pos" | "hoehe" | "farbe" | "fuellung">;

const RING: InselOhnePos[] = [
  {
    id: "einkauf",
    name: "Einkauf & Lieferanten",
    href: "/",
    status: "warn",
    kopf: { label: "unterwegs", wert: "214 kg" },
    kpis: [
      { label: "Ware unterwegs", wert: "214 kg" },
      { label: "Offene Bestellungen", wert: "6" },
      { label: "Offene Zahlungen", wert: "38.400 $" },
      { label: "Nächste Ankunft", wert: "19.11." },
    ],
    vorschlaege: [
      {
        id: "ek1",
        art: "warn",
        titel: "Restzahlung Amanda in 5 Tagen fällig",
        detail: "12.800 $ für die Oktober-Bestellung. Liquidität reicht laut Vorschau.",
        aktion: "Zahlung einplanen",
      },
      {
        id: "ek2",
        art: "idee",
        titel: "Nachbestellung Tapes Usbekisch vorbereitet",
        detail: "7 Farben fallen in 4 Wochen unter die Reichweite. Entwurf mit 42 kg liegt bereit.",
        aktion: "Entwurf ansehen",
      },
    ],
  },
  {
    id: "lager",
    name: "Lager",
    href: "/stock",
    status: "alarm",
    kopf: { label: "kritisch", wert: "11 Farben" },
    kpis: [
      { label: "Bestand", wert: "486 kg" },
      { label: "Kritische Farben", wert: "11", gut: false },
      { label: "Ausverkauft", wert: "4", gut: false },
      { label: "Ladenhüter", wert: "23" },
    ],
    vorschlaege: [
      {
        id: "la1",
        art: "alarm",
        titel: "4 Topseller sind ausverkauft",
        detail: "Für 2 davon laufen noch Anzeigen. Nachschub kommt am 19.11.",
        aktion: "Anzeigen drosseln",
      },
      {
        id: "la2",
        art: "idee",
        titel: "23 Ladenhüter für Black Friday",
        detail: "Seit über 120 Tagen kaum Verkauf. Vorschlag: 20 % Rabatt als Sale-Kollektion.",
        aktion: "Sale-Liste öffnen",
      },
    ],
  },
  {
    id: "versand",
    name: "Versand & Retouren",
    href: "/pack",
    status: "ok",
    kopf: { label: "heute gepackt", wert: "37 Pakete" },
    kpis: [
      { label: "Heute gepackt", wert: "37" },
      { label: "Noch offen", wert: "9" },
      { label: "Retourenquote", wert: "6,8 %", trend: "−0,4", gut: true },
      { label: "Ø Packzeit", wert: "3:12 min" },
    ],
    vorschlaege: [
      {
        id: "ve1",
        art: "idee",
        titel: "Black Friday: zweite Packstation einplanen",
        detail: "Im Vorjahr waren es in der Woche 3,4-mal so viele Pakete wie sonst.",
        aktion: "Schichtplan öffnen",
      },
    ],
  },
  {
    id: "shop",
    name: "Online-Shop",
    status: "ok",
    kopf: { label: "Umsatz heute", wert: "4.820 €" },
    kpis: [
      { label: "Umsatz heute", wert: "4.820 €", trend: "+12 %", gut: true },
      { label: "Bestellungen", wert: "41" },
      { label: "Kaufrate", wert: "2,7 %" },
      { label: "Ø Warenkorb", wert: "118 €" },
    ],
    vorschlaege: [
      {
        id: "sh1",
        art: "warn",
        titel: "Viele Abbrüche im Warenkorb am Handy",
        detail: "Am Handy kaufen 1,9 %, am Computer 4,1 %. Größter Absprung beim Versand-Schritt.",
        aktion: "Auswertung ansehen",
      },
    ],
  },
  {
    id: "marketing",
    name: "Marketing & Ads",
    status: "warn",
    kopf: { label: "ROAS", wert: "3,4" },
    kpis: [
      { label: "Ausgaben heute", wert: "640 €" },
      { label: "ROAS (echt)", wert: "3,4", trend: "+0,3", gut: true },
      { label: "Kosten pro Kauf", wert: "27,40 €" },
      { label: "Aktive Anzeigen", wert: "18" },
    ],
    vorschlaege: [
      {
        id: "ma1",
        art: "warn",
        titel: "Anzeigengruppe „Lookalike 3 %“ ist zu teuer",
        detail: "Kosten pro Kauf 61 €, Ziel sind 30 €. Seit 5 Tagen darüber.",
        aktion: "Pausieren",
      },
      {
        id: "ma2",
        art: "idee",
        titel: "Advantage+ schlägt Interessen um 22 %",
        detail: "Budget aus dem Interessen-Test herüberziehen.",
        aktion: "Übernehmen",
      },
      {
        id: "ma3",
        art: "idee",
        titel: "4 neue Hooks aus dem Content-Studio bereit",
        detail: "Testkampagne ist fertig angelegt und muss nur noch gestartet werden.",
        aktion: "Starten",
      },
    ],
  },
  {
    id: "content",
    name: "Content & Creative",
    status: "ok",
    kopf: { label: "diese Woche", wert: "9 Posts" },
    kpis: [
      { label: "Geplante Posts", wert: "9" },
      { label: "Reels in Arbeit", wert: "3" },
      { label: "Bestes Reel", wert: "48.200 Aufrufe" },
      { label: "Neue Creatives", wert: "4" },
    ],
    vorschlaege: [
      {
        id: "co1",
        art: "idee",
        titel: "Vorher-Nachher-Reel wiederholen",
        detail: "Das Format bringt 3-mal so viele Profilbesuche wie Produktvideos.",
        aktion: "Als Aufgabe anlegen",
      },
    ],
  },
  {
    id: "service",
    name: "Kundenservice",
    href: "/chatbot/inbox",
    status: "warn",
    kopf: { label: "offen", wert: "14 Chats" },
    kpis: [
      { label: "Offene Chats", wert: "14" },
      { label: "Vom Bot gelöst", wert: "71 %" },
      { label: "Ø Antwortzeit", wert: "4 min" },
      { label: "Warteliste", wert: "32" },
    ],
    vorschlaege: [
      {
        id: "se1",
        art: "warn",
        titel: "3 Chats warten seit über 2 Stunden",
        detail: "Alle drei drehen sich um Farbberatung, der Bot hat an einen Menschen übergeben.",
        aktion: "Inbox öffnen",
      },
      {
        id: "se2",
        art: "idee",
        titel: "6 Kundinnen auf der Warteliste: Ware wieder da",
        detail: "Benachrichtigungen sind vorgeschrieben und müssen nur noch abgeschickt werden.",
        aktion: "Prüfen & senden",
      },
    ],
  },
  {
    id: "team",
    name: "Team",
    href: "/staff/vacation",
    status: "ok",
    kopf: { label: "heute da", wert: "7 von 9" },
    kpis: [
      { label: "Heute da", wert: "7 von 9" },
      { label: "Im Urlaub", wert: "1" },
      { label: "Krank", wert: "1" },
      { label: "Offene Urlaubsanträge", wert: "2" },
    ],
    vorschlaege: [
      {
        id: "te1",
        art: "idee",
        titel: "2 Urlaubsanträge warten auf Antwort",
        detail: "Beide liegen außerhalb der Black-Friday-Sperrzeit.",
        aktion: "Anträge ansehen",
      },
    ],
  },
  {
    id: "salon",
    name: "Salon",
    href: "/salon-admin",
    status: "ok",
    kopf: { label: "Termine heute", wert: "8" },
    kpis: [
      { label: "Termine heute", wert: "8" },
      { label: "Einnahmen heute", wert: "1.460 €" },
      { label: "Auslastung Woche", wert: "83 %" },
      { label: "Freie Termine", wert: "5" },
    ],
    vorschlaege: [
      {
        id: "sa1",
        art: "idee",
        titel: "Donnerstag hat noch 3 freie Termine",
        detail: "Story mit Last-Minute-Terminen vorschlagen.",
        aktion: "An Content geben",
      },
    ],
  },
  {
    id: "finanzen",
    name: "Finanzen",
    href: "/finances/liquiditaet",
    status: "ok",
    kopf: { label: "Kontostand", wert: "86.300 €" },
    kpis: [
      { label: "Kontostand", wert: "86.300 €" },
      { label: "Reicht für", wert: "11 Wochen" },
      { label: "HY-Score", wert: "742", trend: "+18", gut: true },
      { label: "Steuer-Rücklage", wert: "21.500 €" },
    ],
    vorschlaege: [
      {
        id: "fi1",
        art: "idee",
        titel: "Umsatzsteuer-Vorauszahlung am 10.12.",
        detail: "Voraussichtlich 9.200 €. In der Liquiditätsvorschau bereits berücksichtigt.",
        aktion: "Vorschau öffnen",
      },
    ],
  },
];

export const ZENTRALE: Insel = {
  id: "zentrale",
  name: "Zentrale",
  status: "ok",
  kopf: { label: "heute wichtig", wert: "5 Punkte" },
  kpis: [
    { label: "Umsatz heute", wert: "6.280 €", trend: "+9 %", gut: true },
    { label: "Umsatz Monat", wert: "71.400 €" },
    { label: "Bis Black Friday", wert: "15 Tage" },
    { label: "HY-Score", wert: "742", trend: "+18", gut: true },
  ],
  vorschlaege: [],
  pos: [0, 0, 0],
  hoehe: 9,
  farbe: AKZENT,
  fuellung: 1,
};

export const INSELN: Insel[] = RING.map((insel, i) => {
  const winkel = (i / RING.length) * Math.PI * 2 - Math.PI / 2;
  return {
    ...insel,
    pos: [Math.cos(winkel) * RING_RADIUS, 0, Math.sin(winkel) * RING_RADIUS],
    hoehe: 1.3 + (i % 3) * 0.55,
    ...BEREICHE[insel.id],
  };
});

export const ALLE_INSELN: Insel[] = [ZENTRALE, ...INSELN];

export const FLUESSE: Fluss[] = [
  { id: "f1", von: "einkauf", nach: "lager", art: "ware", text: "214 kg Ware unterwegs", menge: 9, tempo: 0.07 },
  { id: "f2", von: "lager", nach: "versand", art: "ware", text: "46 Bestellungen zum Packen", menge: 12, tempo: 0.12 },
  { id: "f3", von: "versand", nach: "shop", art: "ware", text: "37 Pakete an Kundinnen", menge: 10, tempo: 0.14 },
  { id: "f4", von: "marketing", nach: "shop", art: "besucher", text: "1.520 Besucher über Anzeigen", menge: 22, tempo: 0.16 },
  { id: "f5", von: "content", nach: "marketing", art: "signale", text: "4 neue Creatives", menge: 5, tempo: 0.1 },
  { id: "f6", von: "shop", nach: "finanzen", art: "geld", text: "4.820 € Umsatz heute", menge: 14, tempo: 0.1 },
  { id: "f7", von: "salon", nach: "finanzen", art: "geld", text: "1.460 € Einnahmen heute", menge: 6, tempo: 0.1 },
  { id: "f8", von: "finanzen", nach: "einkauf", art: "geld", text: "38.400 $ offene Zahlungen", menge: 7, tempo: 0.08 },
  { id: "f9", von: "shop", nach: "service", art: "signale", text: "14 offene Anfragen", menge: 8, tempo: 0.12 },
  { id: "f10", von: "finanzen", nach: "marketing", art: "geld", text: "640 € Werbebudget heute", menge: 5, tempo: 0.09 },
];

export function inselNachId(id: string): Insel | undefined {
  return ALLE_INSELN.find((i) => i.id === id);
}
