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
  /** Größe eines Notizzettels in Pixel. */
  breite?: number;
  hoehe?: number;
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
  /** Bestellwert vor Erstattungen je Kalendertag: dieser Monat (bis heute, heute = bisher) und der
   *  ganze Vorjahresmonat. null = Shopify nicht erreichbar. */
  tage: Array<{ tag: number; dieses: number | null; letztes: number | null }> | null;
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
  /** "Fast tot" zählt ab dieser Reichweite in Monaten (wie die Ladenhüter-Seite). */
  fastTotAbMonate: number;
  tot: { wertEur: number; kg: number; anzahl: number };
  fastTot: { wertEur: number; kg: number; anzahl: number };
  /** Produkte ohne Shopify-Preis — im Wert nicht enthalten. */
  ohnePreis: number;
  kollektionen: Array<{ name: string; wertEur: number; kg: number; anzahl: number }>;
  produkte: Array<{ name: string; kollektion: string; wertEur: number; kg: number; art: "tot" | "fasttot" }>;
}

export interface InstagramDaten {
  follower: number | null;
  /** Gesamtstand vor 30 Tagen (gemessen oder zurückgerechnet). */
  followerVor30: number | null;
  /** Ein Eintrag je Tag, ältester zuerst (bis gestern; die jüngsten Tage können noch fehlen). */
  tage: Array<{ tag: string; neu: number | null; verloren: number | null; follower: number | null; reichweite: number | null }>;
  /** Summen über die letzten 7/30 Tage mit vollständigen Daten, dazu der Zeitraum davor. */
  d7: { neu: number; verloren: number; vorNeu: number; vorVerloren: number; reichweite: number; vorReichweite: number; profil: number; klicks: number };
  d30: { neu: number; verloren: number; vorNeu: number; vorVerloren: number };
  /** Letzter Tag mit Follower-Zahlen von Instagram (Verzug 1–2 Tage). */
  bisAm: string | null;
  demografie: { alter: Record<string, number>; geschlecht: Record<string, number>; land: Record<string, number>; stadt: Record<string, number> } | null;
  /** Stunde (deutsche Zeit) → Follower online. */
  online: Record<string, number> | null;
}

export interface IgAnfragenPeriode {
  tage: number;
  gespraeche: number;
  nachrichten: number;
  davor: { gespraeche: number; nachrichten: number };
  vorjahr: { gespraeche: number; nachrichten: number } | null;
  kategorien: Array<{ kategorie: string; gespraeche: number }>;
}

export interface IgAnfragenDaten {
  heute: { gespraeche: number; nachrichten: number };
  /** Gleicher Wochentag letzte Woche bis zur gleichen Uhrzeit. */
  vorwoche: { gespraeche: number; nachrichten: number };
  perioden: IgAnfragenPeriode[];
  /** Gespräche je Tag, letzte 180 Tage (ältester zuerst) und dieselben Tage ein Jahr davor. */
  tage: Array<{ tag: string; n: number }>;
  tageVorjahr: Array<{ tag: string; n: number }>;
  /** Kundennachrichten je Wochentag (1 = Mo) und Stunde, letzte 30 Tage. */
  stunden: Array<{ wochentag: number; stunde: number; n: number }>;
}

export interface WerbungDaten {
  /** Letzter Tag mit Meta-Daten im Marketing-Projekt; null = keine. */
  metaStand: string | null;
  googleStand: string | null;
  /** 7 Tage bis metaStand und die 7 Tage davor. */
  meta7: number;
  metaVor7: number;
  google7: number;
  googleVor7: number;
  /** Shopify-Umsatz in denselben 7 Tagen (für Werbekosten je 100 € Umsatz). */
  umsatz7: number;
  tage: Array<{ datum: string; meta: number; google: number; umsatz: number }>;
  /** Kampagnen mit Ausgaben in den letzten 14 Tagen. */
  kampagnen: Array<{ name: string; kosten: number; klicks: number; impressionen: number; reichweite: number }>;
  googleKampagnen: Array<{ name: string; kosten: number; klicks: number }>;
}

export type AuffaelligBereich = "lager" | "chats" | "werbung" | "aktionen" | "zahlungen" | "finanzen" | "versand" | "retouren" | "steuern" | "instagram" | "umsatz" | "daten";

export interface Auffaelligkeit {
  id: string;
  bereich: AuffaelligBereich;
  schwere: "hoch" | "mittel" | "hinweis";
  titel: string;
  detail: string;
  href?: string;
  liste?: string[];
}

export interface Bericht {
  tag: string;
  stand: string;
  punkte: Auffaelligkeit[];
  /** Prüfungen, die nicht laufen konnten (Quelle nicht erreichbar). */
  fehler: string[];
}

export interface NewsletterZeitraum {
  neu: number;
  ausstehend: number;
  abmeldungen: number;
  vorNeu: number;
  vorAusstehend: number;
  vorAbmeldungen: number;
}

export interface NewsletterDaten {
  bestand: { abonniert: number; ausstehend: number; abgemeldet: number; tag: string } | null;
  d7: NewsletterZeitraum;
  d30: NewsletterZeitraum;
  /** Anteil bestätigter Anmeldungen an allen Anmeldungen der letzten 30 Tage (%). */
  bestaetigt30: number | null;
  /** Abonnenten vor 30 Tagen (rekonstruiert), für die Veränderung. */
  abonniertVor30: number | null;
  monate: Array<{ monat: string; neu: number; ausstehend: number; abmeldungen: number; ende: number | null }>;
  tage: Array<{ tag: string; neu: number; ausstehend: number; abmeldungen: number; abonniert: number | null }>;
  /** Automatische Einordnung (Einbruch, viele Unbestätigte …). */
  hinweise: Array<{ ton: "gut" | "warn" | "info"; text: string }>;
  schlagzeile: string;
  unterzeile: string;
}

export interface RoutineProdukt {
  handle: string;
  titel: string;
  bestand: number | null;
  /** verkauft je Tag (Ø 60 Tage) */
  proTag: number | null;
  /** Tage, die der Bestand reicht; null = kein Verkauf */
  reichtTage: number | null;
}

export interface Routine {
  id: string;
  titel: string;
  art: "intervall" | "lager";
  intervallTage: number | null;
  quelle: string | null;
  lieferzeitTage: number | null;
  pufferTage: number;
  notiz: string;
  farbe: string;
  letzteErledigung: string | null;
  erledigtVon: string | null;
  /** Bei Lieferanten-Routinen: Datum der letzten Bestellung im Dashboard. */
  letzteBestellung: string | null;
  /** Tag, an dem die Routine fällig ist/war (Intervall) bzw. bestellt werden muss (Lager). */
  faellig: string | null;
  /** Tage bis fällig (negativ = überfällig). */
  tageBis: number | null;
  /** 0 = gerade erledigt … 1 = fällig, > 1 = überfällig (für den Ring). */
  fortschritt: number;
  status: "ok" | "bald" | "faellig" | "ueberfaellig" | "ruht";
  produkte: RoutineProdukt[];
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
  { id: "sturm", name: "Auffälligkeiten", info: "Täglicher Prüfbericht: was gerade schiefläuft", feature: "finances" },
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
  { id: "instagram", name: "Instagram", info: "Follower, Zu- und Abgänge, wer folgt, beste Zeit", feature: "chatbot" },
  { id: "iganfragen", name: "Instagram-Anfragen", info: "DMs je Tag, gegen Vorwoche und Vorjahr", feature: "chatbot" },
  { id: "werbung", name: "Werbung", info: "Laufende Anzeigen bei Meta & Google, Kosten", feature: "finances" },
  { id: "newsletter", name: "Newsletter", info: "Der Hairvenly Kurier: Abonnenten, neue, Abmeldungen", feature: "admin" },
  { id: "routinen", name: "Routinen", info: "Was regelmäßig dran ist: Bestellungen, Nachschub …", feature: null },
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
  { i: "sturm", x: 0, y: 3, w: 12, h: 11 },
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
  { i: "instagram", x: 0, y: 74, w: 12, h: 12 },
  { i: "iganfragen", x: 0, y: 86, w: 7, h: 12 },
  { i: "werbung", x: 7, y: 86, w: 5, h: 12 },
  { i: "hi", x: 0, y: 63, w: 5, h: 11 },
  { i: "newsletter", x: 0, y: 98, w: 6, h: 13 },
  { i: "routinen", x: 6, y: 98, w: 6, h: 13 },
];

export const MIN_GROESSE: Record<string, { w: number; h: number }> = {
  hi: { w: 3, h: 7 },
  lage: { w: 3, h: 2 },
  liquiditaet: { w: 4, h: 5 },
};
