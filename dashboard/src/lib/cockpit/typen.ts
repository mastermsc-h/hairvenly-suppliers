// Startbildschirm ("Cockpit") — Typen, die Server und Client teilen (keine Server-Importe!).

export type Ampel = "ok" | "warn" | "alarm";

export type EintragArt = "notiz" | "idee" | "aufgabe" | "meilenstein" | "pfeiler" | "aktion" | "philosophie";

export interface EintragDaten {
  farbe?: string;
  /** YYYY-MM-DD */
  faellig?: string;
  zustaendig?: string;
  prio?: "hoch" | "normal";
  /** 0–100 */
  fortschritt?: number;
  von?: string;
  bis?: string;
  link?: string;
}

export interface Eintrag {
  id: string;
  art: EintragArt;
  owner_id: string | null;
  owner_name: string | null;
  titel: string;
  text: string;
  daten: EintragDaten;
  erledigt_am: string | null;
  sort: number;
  created_at: string;
}

export interface LayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CockpitLayout {
  items: LayoutItem[];
  /** Ausgeblendete Widgets. */
  aus: string[];
  /** Lichtpulse in den Spalten zwischen den Fenstern (Standard: an). */
  adern?: boolean;
  /** Abstand zwischen den Fenstern in Pixel (4–32, Standard 12). */
  abstand?: number;
  /** Aussehen der Fenster (Standard: "standard"). */
  stil?: KachelStil;
}

export type KachelStil = "standard" | "glas" | "aurora";
export const KACHEL_STILE: Array<{ id: KachelStil; name: string; info: string }> = [
  { id: "standard", name: "Standard", info: "Hell und ruhig" },
  { id: "glas", name: "Glas", info: "Milchglas vor leuchtenden Farbwolken" },
  { id: "aurora", name: "Aurora", info: "Jedes Fenster in seiner eigenen Farbe" },
];

export interface Signal {
  ampel: Ampel;
  titel: string;
  detail: string;
  href?: string;
}

export interface ChatDaten {
  d7: number;
  p7: number;
  d30: number;
  p30: number;
  wartend: number;
  /** Neue Chats je Tag, letzte 30 Tage (ältester zuerst). */
  serie: Array<{ tag: string; n: number }>;
}

export interface UmsatzDaten {
  monat: string; // YYYY-MM
  monatNetto: number;
  monatBestellungen: number;
  /** Vorjahresmonat komplett (null = keine Daten). */
  vorjahrMonat: number | null;
  /** Bestellwert vor Erstattungen vom 1. bis gestern — dieses Jahr und dieselben Tage im Vorjahr
   *  (live aus Shopify; null = Monatserster oder Shopify nicht erreichbar). */
  tageVergleich: { bisTag: number; dieses: number; letztes: number } | null;
  /** Hochrechnung auf den vollen Monat nach bisherigem Tagesschnitt. */
  hochrechnung: number;
  jahr: number;
  jahrNetto: number;
  /** Vergleich nur über Monate, die es in beiden Jahren gibt. */
  vergleich: { label: string; dieses: number; letztes: number } | null;
  /** 12 Monate: dieses Jahr vs. letztes Jahr. */
  monate: Array<{ m: string; dieses: number | null; letztes: number | null }>;
  stand: string | null;
  /** Laufender Monat live aus Shopify (false = Stand der Nachtsynchronisation, heute fehlt). */
  live: boolean;
}

export interface ShopifyDaten {
  heute: { bestellungen: number; umsatz: number } | null;
  gestern: { bestellungen: number; umsatz: number } | null;
  warenkorb: number | null;
  warenkorbVormonat: number | null;
  erstattungsQuote: number | null;
  kanaele: Array<{ name: string; wert: number }>;
  neukundenAnteil: number | null;
  stammkundenAnteil: number | null;
  kundenMonat: string | null;
  topseller: Array<{ name: string; stueck: number }>;
}

export interface AuslandDaten {
  /** Heute live aus Shopify (null = nicht erreichbar). */
  heute: { n: number; umsatz: number; laender: string[] } | null;
  /** Montag bis heute — gegen Montag bis zum selben Wochentag der Vorwoche. */
  woche: { n: number; umsatz: number; vorN: number; vorUmsatz: number };
  /** Letzte 28 Tage gegen die 28 Tage davor; anteil = Anteil an allen Bestellungen mit Lieferland (%). */
  d28: { n: number; umsatz: number; vorN: number; vorUmsatz: number; anteil: number; anteilVor: number };
  /** 12 Kalenderwochen (älteste zuerst), Bestellungen je Land; "rest" = übrige Länder. */
  wochen: Array<{ start: string; label: string } & Record<string, number | string>>;
  /** Länder im Diagramm (meistbestellt zuerst), danach ggf. "rest". */
  reihen: Array<{ code: string; name: string }>;
  laender: Array<{ code: string; name: string; n: number; umsatz: number; vorN: number }>;
  standBis: string | null;
}

export interface TotesKapitalDaten {
  /** Ladenhüter gesamt: Lager × aktueller Shopify-Verkaufspreis. */
  wertEur: number;
  kg: number;
  anzahl: number;
  /** Anteil am bewerteten Lager (kg, %). */
  anteilLager: number;
  tot: { wertEur: number; kg: number; anzahl: number };
  fastTot: { wertEur: number; kg: number; anzahl: number };
  /** Produkte ohne Shopify-Preis — im Wert nicht enthalten. */
  ohnePreis: number;
  kollektionen: Array<{ name: string; wertEur: number; kg: number; anzahl: number }>;
  produkte: Array<{ name: string; kollektion: string; wertEur: number; kg: number; art: "tot" | "fasttot" }>;
}

export interface BesucherDaten {
  verbunden: boolean;
  grund?: string;
  sitzungen7?: number;
  sitzungenVor7?: number;
  conversion7?: number;
  conversionVor7?: number;
  warenkorb7?: number;
  checkout7?: number;
  serie?: Array<{ tag: string; n: number }>;
}

export interface HyDaten {
  score: number;
  delta7: number | null;
  delta30: number | null;
  /** Gibt es noch keine 7 Tage Verlauf: Veränderung seit dem ältesten Eintrag. */
  deltaSeit: { tag: string; delta: number } | null;
  kg: number;
  kontenEur: number;
  schuldenEur: number;
  stand: string;
  serie: Array<{ tag: string; score: number }>;
}

export type LiqGruppe = "amanda" | "ebru" | "ust" | "steuer" | "einfuhr";

export interface LiquiditaetDaten {
  heute: string;
  start: number;
  puffer: number;
  tiefpunkt: { datum: string; saldo: number };
  ampel: Ampel;
  tage: Array<{ datum: string; saldo: number }>;
  /** Geplante Zahlungen als Punkte im Diagramm: je Tag und Gruppe zusammengefasst (betrag negativ = Abgang). */
  marken: Array<{ datum: string; betrag: number; label: string; gruppe: LiqGruppe; geschaetzt: boolean }>;
}

export interface PflichtPosten {
  gruppe: "steuern" | "personal" | "fixkosten" | "gebuehren" | "lieferanten" | "einfuhr" | "sonstiges";
  label: string;
  betrag: number; // positiv = zu zahlen
  geschaetzt: boolean;
}

export interface PflichtenDaten {
  tage: number;
  verfuegbar: number;
  einnahmenErwartet: number;
  posten: PflichtPosten[];
  summe: number;
  /** Niedrigster Kontostand im Zeitraum laut Liquiditätsvorschau. */
  tiefpunkt: { datum: string; saldo: number };
  puffer: number;
  ampel: Ampel;
  termine: Array<{ datum: string; label: string; betrag: number; geschaetzt: boolean }>;
}

export interface KampagneDaten {
  id: string;
  name: string;
  von: string;
  bis: string | null;
  farbe: string;
  notiz: string | null;
  quelle: "chatbot" | "liquiditaet";
}

export const WIDGETS = [
  { id: "hi", name: "Hi · Hairvenly Intelligence", info: "Frag die KI alles über Hairvenly", feature: "admin" },
  { id: "lage", name: "Lagebild", info: "Wo läuft es, wo hakt es", feature: null },
  { id: "umsatz", name: "Umsatz", info: "Monat & Jahr gegen Vorjahr", feature: "finances" },
  { id: "chats", name: "Neue Chats", info: "7 und 30 Tage im Vergleich", feature: "chatbot" },
  { id: "hy", name: "HY-Score", info: "Lager + Konten − Schulden", feature: "finances" },
  { id: "aufgaben", name: "Dringende Aufgaben", info: "Team-Aufgaben anlegen & abhaken", feature: null },
  { id: "pflichten", name: "Was kommt auf uns zu", info: "Steuern, Löhne, Fixkosten – reicht das Konto?", feature: "finances" },
  { id: "shopify", name: "Shopify", info: "Heute, Warenkorb, Kunden, Topseller", feature: "finances" },
  { id: "besucher", name: "Besucher & Conversion", info: "Sitzungen und Kaufquote im Shop", feature: "finances" },
  { id: "ausland", name: "Auslandsbestellungen", info: "Österreich & Co.: Tag, Woche, Trend", feature: "finances" },
  { id: "toteskapital", name: "Totes Kapital", info: "Ladenhüter: gebundener Warenwert", feature: "finances" },
  { id: "notizen", name: "Notizzettel", info: "Nur für dich", feature: null },
  { id: "ideen", name: "Ideen & Inspiration", info: "Sammelstelle fürs Team", feature: null },
  { id: "pfeiler", name: "Wachstumspfeiler", info: "Die großen Hebel des Unternehmens", feature: null },
  { id: "meilensteine", name: "Meilensteine", info: "Was erreicht ist, was kommt", feature: null },
  { id: "aktionen", name: "Aktuelle Aktionen", info: "Laufende und geplante Aktionen", feature: null },
  { id: "philosophie", name: "Firmenphilosophie", info: "Wofür Hairvenly steht", feature: null },
  { id: "liquiditaet", name: "Liquidität", info: "Kontostand der nächsten 90 Tage", feature: "finances" },
  { id: "marketing", name: "Marketing (HALO)", info: "Dringende Aufgaben des Marketing-Teams", feature: "finances" },
] as const;

export type WidgetId = (typeof WIDGETS)[number]["id"];

/** Standard-Anordnung im 12er-Raster (Zeilenhöhe 28 px + 16 px Abstand). */
export const STANDARD_LAYOUT: LayoutItem[] = [
  { i: "lage", x: 0, y: 0, w: 12, h: 3 },
  { i: "umsatz", x: 0, y: 3, w: 5, h: 8 },
  { i: "chats", x: 5, y: 3, w: 4, h: 4 },
  { i: "hy", x: 9, y: 3, w: 3, h: 8 },
  { i: "besucher", x: 5, y: 7, w: 4, h: 4 },
  { i: "aufgaben", x: 0, y: 11, w: 4, h: 8 },
  { i: "pflichten", x: 4, y: 11, w: 4, h: 8 },
  { i: "shopify", x: 8, y: 11, w: 4, h: 8 },
  { i: "ausland", x: 0, y: 19, w: 12, h: 10 },
  { i: "notizen", x: 0, y: 29, w: 6, h: 7 },
  { i: "ideen", x: 6, y: 29, w: 6, h: 7 },
  { i: "pfeiler", x: 0, y: 36, w: 5, h: 8 },
  { i: "meilensteine", x: 5, y: 36, w: 4, h: 8 },
  { i: "aktionen", x: 9, y: 36, w: 3, h: 4 },
  { i: "philosophie", x: 9, y: 40, w: 3, h: 4 },
  { i: "liquiditaet", x: 0, y: 44, w: 12, h: 8 },
  { i: "marketing", x: 0, y: 52, w: 6, h: 8 },
  { i: "toteskapital", x: 6, y: 52, w: 6, h: 11 },
  { i: "hi", x: 0, y: 63, w: 5, h: 11 },
];

export const MIN_GROESSE: Record<string, { w: number; h: number }> = {
  hi: { w: 3, h: 7 },
  lage: { w: 3, h: 2 },
  liquiditaet: { w: 4, h: 5 },
};
