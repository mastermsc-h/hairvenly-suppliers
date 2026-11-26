"use client";

import { useState, useTransition } from "react";
import { BookOpen, CheckCircle2, Circle, ExternalLink, Loader2 } from "lucide-react";
import { setSteuertippUmgesetzt } from "@/lib/actions/steuertipps";
import { Karte } from "./ui";

type Gruppe = "inhaber" | "mitarbeiter" | "manager";
type Wann = "monatlich" | "jahresende" | "einmalig";

export type Tipp = {
  titel: string;
  gruppe: Gruppe;
  wann: Wann;
  /** Betrag/Grenze in einem Satz */
  betrag: string;
  firma: string; // Vorteil/Wirkung für die Firma bzw. den Inhaber
  ma?: string; // Vorteil für Mitarbeiter/Manager
  wie: string; // so wird es gemacht / abgesetzt
  achtung?: string;
  gilt?: "bilanz" | "euer";
  status?: "neu" | "unsicher" | "geht-nicht";
  quelle?: string;
};

export const TIPPS: Tipp[] = [
  // ── Mitarbeiter ────────────────────────────────────────────────────────────────────
  {
    titel: "50-€-Gutschein- oder Guthabenkarte jeden Monat",
    gruppe: "mitarbeiter", wann: "monatlich",
    betrag: "50 € pro Monat und Mitarbeiter = 600 € im Jahr",
    firma: "Voll Betriebsausgabe, keine Lohnnebenkosten (kein AG-Anteil SV).",
    ma: "Komplett steuer- und sozialversicherungsfrei — 50 € netto = 50 € Wert. Eine Gehaltserhöhung um 50 € netto kostet die Firma ~110 €.",
    wie: "Karte mit begrenztem Einsatzbereich (z. B. regionale City-Card Bremen, Tankkarte, Gutschein einer Ladenkette). Über die Lohnabrechnung als Sachbezug laufen lassen, Beleg zum Lohnkonto.",
    achtung: "Freigrenze: 50,01 € → alles steuerpflichtig. Nur zusätzlich zum Lohn, nicht statt Gehalt oder vertraglich zugesagtem Bonus. Keine Bargeld-Auszahlung, keine frei verwendbare Visa-Karte.",
    quelle: "https://www.steuerberaten.de/blog/652/steuerfreie-arbeitgeberleistungen/",
  },
  {
    titel: "Personalrabatt auf eigene Extensions & Pflege",
    gruppe: "mitarbeiter", wann: "monatlich",
    betrag: "Rabattfreibetrag 1.080 € pro Jahr und Mitarbeiter",
    firma: "Kein Lohnaufwand — die Ware wird nur günstiger abgegeben. Mitarbeiter tragen Hairvenly-Haare = Werbung im Salon.",
    ma: "Bis 1.080 € Vorteil im Jahr steuer- und SV-frei (gerechnet: Ladenpreis − 4 % − gezahlter Preis).",
    wie: "Mitarbeiter-Rabatt in Shopify (eigener Rabattcode/Kundengruppe), Liste je Mitarbeiter führen (Lohnkonto).",
    achtung: "Nicht mit der 50-€-Grenze für dieselbe Ware kombinieren. Streichung wurde 2026 diskutiert, ist im Entwurf für 2027 aber nicht enthalten.",
    status: "unsicher",
    quelle: "https://www.tageskarte.io/politik/detail/kehrtwende-beim-rabattfreibetrag-streichung-fuer-mitarbeiterrabatte-ist-vom-tisch.html",
  },
  {
    titel: "Geschenke zu Geburtstag, Hochzeit, Geburt",
    gruppe: "mitarbeiter", wann: "monatlich",
    betrag: "bis 60 € brutto je Anlass",
    firma: "Betriebsausgabe.",
    ma: "Steuer- und SV-frei — zusätzlich zu den 50 € im selben Monat.",
    wie: "Sachgeschenk (Blumen, Gutschein, Extensions-Pflegeset) mit Beleg und Anlass notieren.",
    achtung: "Kein Bargeld.",
  },
  {
    titel: "Weihnachts- und Sommerfeier",
    gruppe: "mitarbeiter", wann: "jahresende",
    betrag: "110 € pro Person und Feier, 2 Feiern im Jahr",
    firma: "Voll Betriebsausgabe (Essen, Location, Getränke, Taxi).",
    ma: "Steuerfrei bis 110 € je Feier (inkl. USt und aller Nebenkosten).",
    wie: "Teilnehmerliste + Rechnungen aufbewahren. Kosten ÷ Teilnehmer ≤ 110 €.",
    achtung: "Neu ab 2026: Pauschal versteuern (25 %) über 110 € geht nur noch, wenn die Feier allen Mitarbeitern offensteht.",
    status: "neu",
    quelle: "https://www.tk.de/resource/blob/2186296/709b515e8b4f0db06e86cc3e9e8b6df9/praesentation-pk-i-jw-lohnsteuer-data.pdf",
  },
  {
    titel: "Essenszuschuss (digitale Essensmarken)",
    gruppe: "mitarbeiter", wann: "monatlich",
    betrag: "bis 7,67 € pro Arbeitstag (2026), 7,80 € (2027) — bei 15 Tagen ≈ 115 €/Monat",
    firma: "Voll Betriebsausgabe.",
    ma: "Versteuert wird nur der Sachbezugswert 4,57 € (2027: 4,70 €) — und den kann die Firma pauschal mit 25 % übernehmen → für den Mitarbeiter frei.",
    wie: "Anbieter für digitale Essensmarken (Beleg-Upload per App) oder Restaurantschecks; nur für Arbeitstage.",
    quelle: "https://www.haufe.de/personal/entgelt/sachbezugswerte-fuer-mahlzeiten_78_507192.html",
  },
  {
    titel: "Deutschlandticket / Jobticket",
    gruppe: "mitarbeiter", wann: "monatlich",
    betrag: "in voller Höhe",
    firma: "Betriebsausgabe.",
    ma: "Steuer- und SV-frei (mindert nur die eigene Entfernungspauschale).",
    wie: "Zusätzlich zum Lohn zahlen oder Ticket direkt stellen; Nachweis zum Lohnkonto.",
    achtung: "Nur zusätzlich zum Lohn. Per Gehaltsumwandlung nur mit 25 % Pauschalsteuer.",
  },
  {
    titel: "Fahrtkostenzuschuss fürs Auto",
    gruppe: "mitarbeiter", wann: "monatlich",
    betrag: "0,38 € je Entfernungs-km ab dem 1. km (neu 2026)",
    firma: "Betriebsausgabe + 15 % Pauschalsteuer.",
    ma: "SV-frei, Lohnsteuer übernimmt die Firma pauschal.",
    wie: "Entfernung Wohnung–Salon × Arbeitstage × 0,38 € monatlich zusätzlich zahlen, pauschal 15 % versteuern.",
    status: "neu",
    quelle: "https://www.bundesregierung.de/breg-de/aktuelles/steueraenderungsgesetz-bundesrat-2383684",
  },
  {
    titel: "Dienstrad (Jobrad)",
    gruppe: "mitarbeiter", wann: "einmalig",
    betrag: "zusätzlich zum Lohn: steuerfrei · per Gehaltsumwandlung: 0,25 % vom Listenpreis",
    firma: "Leasingrate ist Betriebsausgabe.",
    ma: "Rad ohne Steuer (zusätzlich) bzw. sehr günstig über Gehaltsumwandlung.",
    wie: "Über einen Leasing-Anbieter, Überlassungsvertrag.",
  },
  {
    titel: "Handy, Laptop, iPad zur privaten Nutzung überlassen",
    gruppe: "mitarbeiter", wann: "einmalig",
    betrag: "unbegrenzt",
    firma: "Gerät + Vertrag sind Betriebsausgabe (Computer/Handy: in einem Jahr abgeschrieben).",
    ma: "Private Nutzung steuer- und SV-frei, auch per Gehaltsumwandlung.",
    wie: "Gerät bleibt Firmeneigentum, Überlassungsvereinbarung.",
    achtung: "Wird das Gerät verschenkt: 25 % Pauschalsteuer.",
  },
  {
    titel: "Internetpauschale",
    gruppe: "mitarbeiter", wann: "monatlich",
    betrag: "50 € pro Monat ohne Nachweis",
    firma: "Betriebsausgabe + 25 % Pauschalsteuer.",
    ma: "SV-frei, ohne Lohnsteuer für den Mitarbeiter.",
    wie: "Erklärung des Mitarbeiters, dass er privat Internet hat; zusätzlich zum Lohn.",
  },
  {
    titel: "Gesundheitskurse (Rücken, Stress, Ernährung)",
    gruppe: "mitarbeiter", wann: "monatlich",
    betrag: "600 € pro Jahr und Mitarbeiter",
    firma: "Betriebsausgabe — gerade im Salon (Stehen, Rücken) sinnvoll.",
    ma: "Steuer- und SV-frei.",
    wie: "Nur zertifizierte Kurse (Zertifikat nach § 20 SGB V, z. B. über die Zentrale Prüfstelle Prävention).",
    achtung: "Fitnessstudio-Beitrag zählt nicht dazu — der geht höchstens über die 50-€-Karte.",
  },
  {
    titel: "Kita-Zuschuss",
    gruppe: "mitarbeiter", wann: "monatlich",
    betrag: "unbegrenzt (Kinder vor der Schulpflicht)",
    firma: "Betriebsausgabe.",
    ma: "Steuer- und SV-frei — für Mütter im Team sehr wertvoll.",
    wie: "Kita-Rechnung im Original zum Lohnkonto, zusätzlich zum Lohn zahlen.",
  },
  {
    titel: "Erholungsbeihilfe",
    gruppe: "mitarbeiter", wann: "einmalig",
    betrag: "156 € Mitarbeiter + 104 € Partner + 52 € je Kind pro Jahr",
    firma: "Betriebsausgabe + 25 % Pauschalsteuer.",
    ma: "SV-frei.",
    wie: "Zeitnah zum Urlaub zahlen (Urlaubsantrag als Beleg).",
  },
  {
    titel: "Schulungen und Weiterbildung",
    gruppe: "mitarbeiter", wann: "einmalig",
    betrag: "ohne Grenze",
    firma: "Betriebsausgabe — Extensions-Techniken, Farbe, Social Media, Sprachkurse.",
    ma: "Steuer- und SV-frei.",
    wie: "Firma bucht und bezahlt die Schulung direkt.",
  },
  {
    titel: "Betriebliche Altersvorsorge (bAV)",
    gruppe: "mitarbeiter", wann: "monatlich",
    betrag: "bis 676 €/Monat (8.112 €/Jahr) steuerfrei, davon 338 € SV-frei (2026)",
    firma: "Beiträge sind Betriebsausgabe. Bei Gehaltsumwandlung spart die Firma SV-Anteile (gibt 15 % Zuschuss weiter).",
    ma: "Rente aus Brutto statt Netto. Geringverdiener (bis 2.575 €/Monat): Firma zahlt 240–960 €/Jahr dazu und bekommt 30 % über die Lohnsteuer zurück.",
    wie: "Direktversicherung oder Pensionskasse über einen Versicherer, Vereinbarung mit dem Mitarbeiter.",
    achtung: "2027 steigt der Rahmen auf ~8.496 €/Jahr und die Geringverdiener-Förderung auf bis 360 €.",
    quelle: "https://www.haufe.de/personal/entgelt/steuerliche-verbesserungen-der-bav_78_660152.html",
  },
  {
    titel: "Sonn-, Feiertags- und Nachtzuschläge",
    gruppe: "mitarbeiter", wann: "monatlich",
    betrag: "Sonntag 50 %, Feiertag 125 %, 25./26.12. und 1. Mai 150 %, Nacht 25 %",
    firma: "Betriebsausgabe — wer z. B. an Sonntagen packt oder Events macht, kann statt Lohn steuerfreie Zuschläge zahlen.",
    ma: "Steuerfrei (Grundlohn bis 50 €/h), SV-frei bis 25 €/h.",
    wie: "Arbeitszeiten genau erfassen, Zuschläge getrennt abrechnen.",
    achtung: "Überstundenzuschläge sind NICHT steuerfrei — das war geplant, wurde aber nicht beschlossen.",
  },
  {
    titel: "Aktivrente: Mitarbeiter im Rentenalter",
    gruppe: "mitarbeiter", wann: "monatlich",
    betrag: "bis 2.000 € pro Monat steuerfrei (seit 2026)",
    firma: "Erfahrene Kräfte halten — normale Lohnkosten, SV-Anteile bleiben.",
    ma: "Lohn bis 2.000 €/Monat ohne Lohnsteuer, wenn die Regelaltersgrenze erreicht ist.",
    wie: "Normales SV-pflichtiges Arbeitsverhältnis (kein Minijob).",
    status: "neu",
    quelle: "https://www.lexware.de/wissen/mitarbeiter-gehalt/aktivrente-2026-das-muessen-arbeitgeber-wissen/",
  },
  {
    titel: "Minijob und Mindestlohn im Blick",
    gruppe: "mitarbeiter", wann: "jahresende",
    betrag: "Minijob 603 € (2026) → 633 € (2027) · Mindestlohn 13,90 € → 14,60 € (2027)",
    firma: "Ab 1.1.2027 Stundenlöhne und Minijob-Stunden prüfen, sonst rutscht ein Minijob über die Grenze.",
    wie: "Stunden der Minijobber für 2027 neu berechnen (633 € ÷ 14,60 € = max. 43 Std./Monat).",
    achtung: "Geplant (noch nicht beschlossen): Minijob-Pauschalsteuer 2 % → 5 % ab 2027.",
    status: "neu",
    quelle: "https://www.etl.de/aktuelles/mindestlohn-und-minijobs-2027/",
  },

  // ── Manager ────────────────────────────────────────────────────────────────────────
  {
    titel: "Bonus richtig timen",
    gruppe: "manager", wann: "jahresende",
    betrag: "Bonus + ~21 % Arbeitgeber-SV voll absetzbar",
    firma: "Senkt ESt und GewSt in dem Jahr, in dem er zählt — bei ~445k Gewinn etwa 49 Cent je Euro.",
    ma: "Normaler Lohn: Lohnsteuer + SV (nur bis zur anteiligen Beitragsgrenze).",
    wie: "Bis 31.12. schriftlich zusagen („Bonus für 2026, zahlbar Januar 2027“) → Rückstellung, zählt schon 2026, Geld fließt erst 2027.",
    achtung: "Immer überweisen: Barzahlungen über 10.000 € sollen ab 2027 nicht mehr absetzbar sein (Jahressteuergesetz 2026, Bundesrat 18.12.).",
  },
  {
    titel: "Bonus teilweise in Altersvorsorge umwandeln",
    gruppe: "manager", wann: "jahresende",
    betrag: "bis 8.112 € pro Jahr steuerfrei, 4.056 € SV-frei (2026)",
    firma: "Gleicher Aufwand, weniger SV-Anteil für die Firma; 15 % Zuschuss weitergeben.",
    ma: "Aus 8.112 € Bonus werden 8.112 € + 15 % Rente statt ca. 4.000–4.500 € netto.",
    wie: "Vereinbarung VOR Fälligkeit des Bonus (z. B. im November für die Dezember-Zahlung), Einmalbeitrag in Direktversicherung.",
    achtung: "Laufende bAV-Beiträge des Jahres werden angerechnet.",
  },
  {
    titel: "Benefit-Paket statt Gehaltserhöhung",
    gruppe: "manager", wann: "monatlich",
    betrag: "z. B. 50 € Karte + 50 € Internet + Handy + Jobrad + Essenszuschuss ≈ 250–300 € netto/Monat",
    firma: "Kostet die Firma kaum mehr als netto, keine/kaum SV.",
    ma: "Für 300 € mehr netto bräuchte es bei Steuersatz 42 % sonst ~600 € brutto mehr Gehalt.",
    wie: "Bei der nächsten Gehaltsrunde zusätzlich zum Lohn vereinbaren (nicht statt einer bestehenden Erhöhung).",
  },
  {
    titel: "Elektro-Dienstwagen",
    gruppe: "manager", wann: "einmalig",
    betrag: "nur 0,25 % vom Listenpreis pro Monat zu versteuern (Listenpreis bis 100.000 €)",
    firma: "Leasing/Abschreibung + Strom + Versicherung = Betriebsausgabe. Laden beim Arbeitgeber steuerfrei.",
    ma: "50.000-€-Auto → nur 125 € geldwerter Vorteil im Monat statt 500 € (Verbrenner 1 %).",
    wie: "Überlassungsvertrag, Fahrtenbuch nicht nötig.",
  },
  {
    titel: "Coaching und Führungstraining",
    gruppe: "manager", wann: "einmalig",
    betrag: "ohne Grenze",
    firma: "Betriebsausgabe.",
    ma: "Steuer- und SV-frei (berufliche Fortbildung).",
    wie: "Firma bucht und zahlt direkt.",
  },
  {
    titel: "Beteiligung am Unternehmen (nur mit GmbH)",
    gruppe: "manager", wann: "einmalig",
    betrag: "bis 2.000 € pro Jahr steuerfrei",
    firma: "Bindet Manager langfristig.",
    ma: "Anteile steuerfrei bis 2.000 €/Jahr.",
    wie: "Setzt Anteile voraus — mit dem Einzelunternehmen nicht möglich.",
  },

  // ── Inhaber / Firma ────────────────────────────────────────────────────────────────
  {
    titel: "Computer, Kassen, Software: in einem Jahr absetzen",
    gruppe: "inhaber", wann: "jahresende",
    betrag: "ohne Grenze — Nutzungsdauer 1 Jahr",
    firma: "MacBook, iMac, iPad, Kassen-Hardware, Drucker, Scanner, Software komplett im Anschaffungsjahr absetzbar.",
    wie: "Bis 31.12. kaufen (Rechnung + Lieferung 2026). Gilt auch für Peripherie und Betriebssoftware.",
    achtung: "Nur was ihr wirklich braucht — Steuern sparen ist nicht Geld sparen.",
  },
  {
    titel: "Geringwertige Wirtschaftsgüter",
    gruppe: "inhaber", wann: "jahresende",
    betrag: "bis 800 € netto je Stück sofort absetzbar",
    firma: "Salonstühle, Föhne, Glätteisen, Regale, Lampen, Kleinmöbel.",
    wie: "Jedes Teil einzeln unter 800 € netto; Anlageverzeichnis führen. Alternative für 250–1.000 €: Sammelposten über 5 Jahre.",
  },
  {
    titel: "Website, Shop und Apps",
    gruppe: "inhaber", wann: "monatlich",
    betrag: "Pflege, Anpassungen, Apps, Agentur-Stunden: sofort",
    firma: "Laufende Kosten (Shopify, Apps, Updates, SEO, Agentur) = sofort Betriebsausgabe.",
    wie: "Rechnungen der Agentur als Wartung/Anpassung ausweisen lassen.",
    achtung: "Eine bei der Agentur komplett neu bestellte Website/Shop wird meist aktiviert und über ~3 Jahre abgeschrieben (ob die 1-Jahres-Regel für Software greift, ist umstritten). Selbst programmiert (eigene Mitarbeiter) = sofort Aufwand.",
    status: "unsicher",
    quelle: "https://www.steuerschroeder.de/blog/?p=78526",
  },
  {
    titel: "Rückstellungen bilden",
    gruppe: "inhaber", wann: "jahresende",
    betrag: "Retouren, Gewährleistung, Aufbewahrung, Abschlusskosten, Resturlaub, Boni",
    firma: "Gewinn 2026 sinkt ohne Geldabfluss; Steuer wird verschoben (Liquidität).",
    wie: "Zum 31.12. mit Berechnungsgrundlage an den Steuerberater (siehe Abschnitt unten).",
    gilt: "bilanz",
  },
  {
    titel: "Ladenhüter in der Inventur abwerten",
    gruppe: "inhaber", wann: "jahresende",
    betrag: "Abwertung auf den erzielbaren Preis (Teilwert)",
    firma: "Gewinn sinkt im Inventurjahr.",
    wie: "Liste der Ladenhüter mit Verkaufszahlen und Sale-Preisen (Seite „Ladenhüter“) zum Jahresabschluss geben.",
    gilt: "bilanz",
  },
  {
    titel: "Kaputte/unverkäufliche Haare belegen",
    gruppe: "inhaber", wann: "monatlich",
    betrag: "~75 kg × ~1.050 € = ~79.000 € Einkaufswert im Jahr",
    firma: "Ohne Beleg rechnet das Finanzamt bei einer Prüfung mit normaler Marge nach — Hinzuschätzung droht.",
    wie: "Vernichtungsprotokoll + Fotos + Entsorgungsbeleg (siehe Abschnitt unten).",
  },
  {
    titel: "Lieferanten vor Silvester bezahlen",
    gruppe: "inhaber", wann: "jahresende",
    betrag: "jeder bezahlte Euro Wareneinkauf mindert den Gewinn 2026",
    firma: "Nur bei EÜR: Steuer ein Jahr später. Bei Bilanz ohne Wirkung.",
    wie: "Offene Amanda-/Ebru-Rechnungen und Anzahlungen bis 31.12. überweisen, soweit die Liquidität reicht.",
    gilt: "euer",
  },
  {
    titel: "10-Tage-Regel bei EÜR",
    gruppe: "inhaber", wann: "jahresende",
    betrag: "regelmäßige Zahlungen 22.12.–10.01.",
    firma: "Miete, Leasing, Versicherungen, USt-Vorauszahlung, die kurz vor/nach Silvester fließen, zählen zum Jahr, zu dem sie gehören.",
    wie: "Januar-Miete am 28.12. zu zahlen bringt also NICHTS für 2026. Einmalige Ausgaben (Werbung, Material) dagegen schon.",
    gilt: "euer",
  },
  {
    titel: "Investitionsabzugsbetrag (IAB)",
    gruppe: "inhaber", wann: "jahresende",
    betrag: "bis 50 % einer geplanten Anschaffung vorab absetzen",
    firma: "Geht für Hairvenly nicht: nur bis 200.000 € Gewinn (laut BFH 2026 sogar inkl. Gewerbesteuer). Gilt auch für die 20 %-Sonderabschreibung.",
    wie: "—",
    quelle: "https://www.grantthornton.de/themen/2026/bfh-urteil-investitionsabzugsbetrag-gewinngrenze-und-gewerbesteuer/",
    status: "geht-nicht",
  },
  {
    titel: "Bewirtung und Geschenke",
    gruppe: "inhaber", wann: "monatlich",
    betrag: "Geschäftsessen 70 % absetzbar · Geschenke an Geschäftspartner bis 50 € je Person/Jahr",
    firma: "Influencer, Lieferanten, Partnersalons, Gewerbekunden.",
    wie: "Bewirtungsbeleg mit Anlass und Teilnehmern; Geschenke mit Empfängerliste. Produkte an Influencer gegen Posting = Werbung (voll absetzbar).",
  },
  {
    titel: "Steuer-Vorauszahlungen anpassen",
    gruppe: "inhaber", wann: "jahresende",
    betrag: "keine Ersparnis, aber Liquidität",
    firma: "Ist der Gewinn deutlich niedriger als angesetzt: Herabsetzung beantragen. Ist er höher: freiwillig erhöhen — ab 2027 sollen Nachzahlungszinsen auf 0,3 % pro Monat (3,6 % im Jahr) verdoppelt werden (Jahressteuergesetz 2026, Bundesrat steht aus).",
    wie: "Steuerberater stellt Antrag beim Finanzamt.",
  },
  {
    titel: "Private Vorsorge: Rürup / Basisrente",
    gruppe: "inhaber", wann: "jahresende",
    betrag: "bis 30.826 € pro Jahr als Sonderausgabe (2026, Ehepaare 61.652 €)",
    firma: "Privat: mindert die Einkommensteuer (nicht die Gewerbesteuer). Bei 45 % Grenzsteuersatz spart jeder Euro ~47 Cent.",
    wie: "Einzahlung bis 31.12. in einen Rürup-Vertrag. Rente ist später steuerpflichtig, Kapital nicht vererbbar/kündbar.",
  },
  {
    titel: "Ehepartner oder Kinder anstellen",
    gruppe: "inhaber", wann: "monatlich",
    betrag: "angemessenes Gehalt, auch Minijob (603 €)",
    firma: "Lohn ist Betriebsausgabe; bei Kindern nutzt jeder den eigenen Grundfreibetrag.",
    wie: "Schriftlicher Vertrag, echte Arbeit, Zahlung aufs eigene Konto des Angehörigen, Stundennachweis — wie mit Fremden.",
    achtung: "Das Finanzamt prüft genau (Fremdvergleich).",
  },
  {
    titel: "Spenden",
    gruppe: "inhaber", wann: "jahresende",
    betrag: "bis 20 % der Einkünfte als Sonderausgabe",
    firma: "Privat: mindert ESt. Sponsoring (mit Gegenleistung/Werbung) ist dagegen Betriebsausgabe und mindert auch die GewSt.",
    wie: "Zuwendungsbestätigung des Vereins; bis 300 € reicht der Kontoauszug.",
  },
  {
    titel: "Achtung 2027: höherer Spitzensteuersatz geplant",
    gruppe: "inhaber", wann: "jahresende",
    betrag: "Entwurf: 45 % schon ab 250.000 €, neu 47 % ab 280.000 €",
    firma: "Falls beschlossen, ist jeder Euro Gewinn 2027 teurer als 2026. Dann lieber Ausgaben ins Jahr 2027 schieben und Einnahmen 2026 mitnehmen — das Gegenteil des üblichen Jahresend-Rats.",
    wie: "Vor großen Vorzieh-Aktionen im Dezember beim Steuerberater nachfragen, ob das Gesetz durch ist (Anhörung war am 04.11.2026).",
    status: "unsicher",
    quelle: "https://www.haufe.de/personal/entgelt/einkommensteuerreformgesetz-2027_78_696382.html",
  },
  {
    titel: "Degressive Abschreibung 30 % (Investitions-Booster)",
    gruppe: "inhaber", wann: "jahresende",
    betrag: "bis 30 % pro Jahr statt linear — für Anschaffungen 01.07.2025 bis 31.12.2027",
    firma: "Teurere bewegliche Anschaffungen (Ladeneinrichtung, Maschinen, Fahrzeuge über 800 €) werden in den ersten Jahren deutlich schneller abgesetzt.",
    wie: "Steuerberater wählt im Anlageverzeichnis „degressiv“. Gilt nicht für Gebäude und immaterielle Güter.",
    status: "neu",
    quelle: "https://kpmg.com/de/de/home/themen/2025/07/stinvsofortpg-bgbl.html",
  },
  {
    titel: "Elektroauto für die Firma: 75 % im ersten Jahr",
    gruppe: "inhaber", wann: "jahresende",
    betrag: "Sonderabschreibung 75 % im Anschaffungsjahr (bis 31.12.2027, auch gebraucht)",
    firma: "Ein 60.000-€-E-Auto mindert den Gewinn im Kaufjahr um 45.000 €. Private Nutzung nur 0,25 % vom Listenpreis pro Monat.",
    wie: "Kauf (nicht Leasing) bis 31.12. mit Zulassung auf die Firma. Keine Gewinngrenze.",
    status: "neu",
    quelle: "https://www.haufe.de/id/beitrag/die-neue-befristete-degressive-abschreibung-52-sonderregelung-fuer-elektromobilitaet-HI17149629.html",
  },
  {
    titel: "Thesaurierung (§ 34a) für Gewinne, die im Lager bleiben",
    gruppe: "inhaber", wann: "jahresende",
    betrag: "~29,8 % statt bis ~48 % auf nicht entnommenen Gewinn; ab 2028 sinkend (27 % → 25 % ab 2032)",
    firma: "Gewinne, die als Warenbestand im Betrieb gebunden sind, werden vorerst günstiger besteuert. Bei späterer Entnahme 25 % + Soli nach.",
    wie: "Antrag in der Steuererklärung, je Jahr wählbar. Steuerberater rechnet aus, wie viel Gewinn im Betrieb bleibt.",
    gilt: "bilanz",
    quelle: "https://www.iww.de/astw/einkommensteuer/folgen-aus-dem-wachstumschancengesetz-die-neue-thesaurierungsbeguenstigung-2024-f161957",
  },
  {
    titel: "E-Rechnung ab 01.01.2027 Pflicht",
    gruppe: "inhaber", wann: "jahresende",
    betrag: "keine Ersparnis — Pflicht bei über 800.000 € Vorjahresumsatz",
    firma: "Rechnungen an deutsche Firmen (Gewerbekunden, Salons) müssen ab 2027 als E-Rechnung (XRechnung/ZUGFeRD) raus. Privatkunden im Shop nicht betroffen.",
    wie: "Shopify-/Rechnungs-App mit ZUGFeRD-Export einrichten, mit dem Steuerberater testen.",
    status: "neu",
    quelle: "https://www.datev.de/web/de/unternehmen/loesungen/themen-im-fokus/aktuelle-themen-fuer-unternehmen/e-rechnung-ab-2027",
  },
  {
    titel: "GmbH oder GmbH + Holding prüfen",
    gruppe: "inhaber", wann: "einmalig",
    betrag: "~32 % statt bis zu ~47 % auf Gewinne, die im Unternehmen bleiben",
    firma: "Gewinne fürs Lager und zum Schuldenabbau würden deutlich geringer besteuert; KSt sinkt ab 2028 schrittweise.",
    wie: "Umwandlung zum 1. Januar mit Steuerberater + Notar planen (siehe Rechner unten).",
  },
];

const GRUPPEN: { key: Gruppe | "alle"; label: string; aktiv: string }[] = [
  { key: "alle", label: "Alle", aktiv: "bg-neutral-900 text-white border-neutral-900" },
  { key: "inhaber", label: "Inhaber & Firma", aktiv: "bg-blue-600 text-white border-blue-600" },
  { key: "manager", label: "Manager", aktiv: "bg-violet-600 text-white border-violet-600" },
  { key: "mitarbeiter", label: "Mitarbeiter", aktiv: "bg-emerald-600 text-white border-emerald-600" },
];
const WANN: { key: Wann | "alle"; label: string }[] = [
  { key: "alle", label: "Immer" },
  { key: "monatlich", label: "Monatlich / laufend" },
  { key: "jahresende", label: "Bis Jahresende" },
  { key: "einmalig", label: "Einmalig / Struktur" },
];
const GRUPPE_STIL: Record<Gruppe, { rand: string; badge: string; label: string }> = {
  inhaber: { rand: "border-t-blue-500", badge: "bg-blue-100 text-blue-800", label: "Inhaber & Firma" },
  manager: { rand: "border-t-violet-500", badge: "bg-violet-100 text-violet-800", label: "Manager" },
  mitarbeiter: { rand: "border-t-emerald-500", badge: "bg-emerald-100 text-emerald-800", label: "Mitarbeiter" },
};

type Stand = "alle" | "offen" | "umgesetzt";

export default function TippsKatalog({ ermittlung, umgesetzt: start }: { ermittlung: "unklar" | "bilanz" | "euer"; umgesetzt: Record<string, string> }) {
  const [gruppe, setGruppe] = useState<Gruppe | "alle">("alle");
  const [wann, setWann] = useState<Wann | "alle">("alle");
  const [stand, setStand] = useState<Stand>("alle");
  const [umgesetzt, setUmgesetzt] = useState<Record<string, string>>(start);
  const [busy, setBusy] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const liste = TIPPS.filter(
    (t) =>
      (gruppe === "alle" || t.gruppe === gruppe) &&
      (wann === "alle" || t.wann === wann) &&
      (stand === "alle" || (stand === "umgesetzt") === !!umgesetzt[t.titel])
  );
  const anzahlUmgesetzt = TIPPS.filter((t) => umgesetzt[t.titel]).length;

  function abhaken(titel: string) {
    const an = !umgesetzt[titel];
    const vorher = umgesetzt;
    // sofort anzeigen, bei Fehler zurück
    setUmgesetzt((u) => {
      const n = { ...u };
      if (an) n[titel] = new Date().toISOString();
      else delete n[titel];
      return n;
    });
    setBusy(titel);
    setFehler(null);
    startTransition(async () => {
      const res = await setSteuertippUmgesetzt(titel, an);
      if (!res.ok) {
        setUmgesetzt(vorher);
        setFehler(res.error ?? "Speichern fehlgeschlagen");
      } else if (an && res.am) {
        setUmgesetzt((u) => ({ ...u, [titel]: res.am! }));
      }
      setBusy(null);
    });
  }

  return (
    <Karte
      titel={`Tipps-Katalog (${liste.length})`}
      ton="blue"
      icon={<BookOpen size={16} />}
      rechts={
        <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800 bg-emerald-100 rounded-full px-2.5 py-1">
          <CheckCircle2 size={13} /> {anzahlUmgesetzt} von {TIPPS.length} umgesetzt
        </span>
      }
    >
      <div className="flex flex-wrap gap-2 mb-2">
        {GRUPPEN.map((g) => (
          <button key={g.key} onClick={() => setGruppe(g.key)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${gruppe === g.key ? g.aktiv : "bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50"}`}>
            {g.label} <span className="opacity-70">({g.key === "alle" ? TIPPS.length : TIPPS.filter((t) => t.gruppe === g.key).length})</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        {(["alle", "offen", "umgesetzt"] as Stand[]).map((s) => (
          <button key={s} onClick={() => setStand(s)} className={`rounded-full border px-3 py-1 text-xs ${stand === s ? "bg-emerald-100 text-emerald-900 border-emerald-300 font-semibold" : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"}`}>
            {{ alle: "Offen + umgesetzt", offen: "Nur offene", umgesetzt: "Nur umgesetzte" }[s]}
          </button>
        ))}
        <span className="w-px bg-neutral-200 mx-1" />
        {WANN.map((w) => (
          <button key={w.key} onClick={() => setWann(w.key)} className={`rounded-full border px-3 py-1 text-xs ${wann === w.key ? "bg-amber-100 text-amber-900 border-amber-300 font-semibold" : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"}`}>
            {w.label}
          </button>
        ))}
      </div>

      {fehler && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{fehler}</div>}
      <div className="grid md:grid-cols-2 gap-3">
        {liste.map((t) => {
          const s = GRUPPE_STIL[t.gruppe];
          const passtNicht = t.gilt && ermittlung !== "unklar" && t.gilt !== ermittlung;
          const erledigt = umgesetzt[t.titel];
          const kannAbhaken = t.status !== "geht-nicht" && !passtNicht;
          return (
            <article
              key={t.titel}
              className={`relative rounded-xl border border-t-4 ${s.rand} p-4 pr-12 transition-colors ${erledigt ? "border-emerald-300 bg-emerald-50/50" : "border-neutral-200"} ${!erledigt && (t.status === "geht-nicht" || passtNicht) ? "opacity-60" : ""}`}
            >
              {kannAbhaken && (
                <button
                  onClick={() => abhaken(t.titel)}
                  disabled={busy === t.titel}
                  title={erledigt ? `Umgesetzt am ${new Date(erledigt).toLocaleDateString("de-DE")} — klicken, um wieder zu öffnen` : "Als umgesetzt abhaken"}
                  aria-label={erledigt ? "Wieder als offen markieren" : "Als umgesetzt abhaken"}
                  className={`absolute top-2.5 right-2.5 rounded-full transition-transform hover:scale-110 ${erledigt ? "text-emerald-600" : "text-neutral-300 hover:text-emerald-500"}`}
                >
                  {busy === t.titel ? <Loader2 size={26} className="animate-spin text-neutral-400" /> : erledigt ? <CheckCircle2 size={30} fill="#059669" className="text-white drop-shadow-sm" /> : <Circle size={26} />}
                </button>
              )}
              <div className="flex flex-wrap items-center gap-1.5 mb-1">
                {erledigt && <span className="text-[10px] font-bold rounded px-1.5 py-0.5 bg-emerald-600 text-white">umgesetzt {new Date(erledigt).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}</span>}
                <span className={`text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 ${s.badge}`}>{s.label}</span>
                {passtNicht && <span className="text-[10px] font-semibold rounded px-1.5 py-0.5 bg-red-100 text-red-800">nur bei EÜR — gilt nicht für uns</span>}
                {t.status === "neu" && <span className="text-[10px] font-semibold rounded px-1.5 py-0.5 bg-sky-100 text-sky-800">neu</span>}
                {t.status === "unsicher" && <span className="text-[10px] font-semibold rounded px-1.5 py-0.5 bg-amber-100 text-amber-800">Änderung möglich</span>}
                {t.status === "geht-nicht" && <span className="text-[10px] font-semibold rounded px-1.5 py-0.5 bg-red-100 text-red-800">geht für uns nicht</span>}
              </div>
              <h3 className="font-bold text-neutral-900">{t.titel}</h3>
              <div className="text-sm font-semibold text-emerald-700 mt-0.5">{t.betrag}</div>
              <dl className="mt-2 space-y-1.5 text-sm">
                <div><dt className="inline font-semibold text-neutral-900">Firma: </dt><dd className="inline text-neutral-700">{t.firma}</dd></div>
                {t.ma && <div><dt className="inline font-semibold text-neutral-900">{t.gruppe === "manager" ? "Manager" : "Mitarbeiter"}: </dt><dd className="inline text-neutral-700">{t.ma}</dd></div>}
                {t.wie !== "—" && <div><dt className="inline font-semibold text-neutral-900">So geht&apos;s: </dt><dd className="inline text-neutral-700">{t.wie}</dd></div>}
                {t.achtung && <div className="rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-900"><b>Achtung:</b> {t.achtung}</div>}
              </dl>
              {t.quelle && (
                <a href={t.quelle} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-blue-700 hover:underline">
                  Quelle <ExternalLink size={11} />
                </a>
              )}
            </article>
          );
        })}
      </div>
    </Karte>
  );
}
