// Kurzbeschreibung je Dashboard-Seite: Hi zeigt sie beim Öffnen des schwebenden Fensters,
// solange das Gespräch dieser Seite noch leer ist. Neue Seiten hier ergänzen.
// Platzhalter in eckigen Klammern ([id]) passen auf jeden Pfadteil.

const SEITEN: Array<[string, string]> = [
  ["/start", "Dein Startbildschirm: alle wichtigen Zahlen als verschiebbare Fenster – Umsatz, Liquidität, Steuern, Auffälligkeiten, Marketing und Team auf einen Blick."],
  ["/", "Die Übersicht der Lieferantenbestellungen mit den wichtigsten Kennzahlen je Lieferant."],

  // Bestellungen & Lieferanten
  ["/orders", "Alle Bestellungen bei unseren Lieferanten (Amanda, Ebru, Aria) mit Status, Beträgen und offenen Zahlungen."],
  ["/orders/archive", "Das Archiv abgeschlossener und ausgeblendeter Lieferantenbestellungen."],
  ["/orders/new", "Hier legst du eine neue Lieferantenbestellung an."],
  ["/orders/wizard", "Der Bestell-Assistent: Bestellvorschläge aus den Lager-Sheets, Budget verteilen und als Bestellung übernehmen."],
  ["/orders/[id]", "Eine einzelne Lieferantenbestellung: Positionen, Zahlungen, Dokumente, Verlauf und Liquiditäts-Ampel."],
  ["/inbound-deliveries", "Wareneingänge: Lieferungen, die ankommen oder angekommen sind, mit Prüfung gegen die Bestellung."],
  ["/inbound-deliveries/new", "Hier erfasst du einen neuen Wareneingang."],
  ["/inbound-deliveries/[id]", "Ein einzelner Wareneingang mit seinen Positionen und Abweichungen."],
  ["/catalog", "Der Produktkatalog: Methoden, Längen und Farben mit der Zuordnung Hairvenly ↔ Lieferant ↔ Shopify."],
  ["/catalog/barcodes", "Barcodes der Produkte – anzeigen, zuordnen und drucken."],
  ["/catalog/barcodes/audit", "Prüfung der Barcodes: fehlende, doppelte oder falsch zugeordnete Codes."],
  ["/prices", "Die Preistabellen der Lieferanten je Methode, Länge und Farbe."],
  ["/customs-ch", "Zoll Schweiz: Unterlagen und Werte für Sendungen in die Schweiz."],

  // Lager
  ["/stock", "Das Produktlager: Bestand, Verkaufstempo und Reichweite aller Produkte."],
  ["/stock/russian", "Lagerbestand Russisch glatt (Amanda) mit Bestand, Unterwegs und Varianten."],
  ["/stock/uzbek", "Lagerbestand Usbekisch wellig (Ebru) mit Bestand, Unterwegs und Varianten."],
  ["/stock/critical", "Kritische Produkte: was bald ausverkauft ist und ob Nachschub rechtzeitig kommt."],
  ["/stock/critical/russian", "Kritische Produkte bei Russisch glatt – Reichweite gegen Lieferzeit."],
  ["/stock/critical/uzbek", "Kritische Produkte bei Usbekisch wellig – Reichweite gegen Lieferzeit."],
  ["/stock/zero", "Produkte mit Nullbestand – was gerade gar nicht lieferbar ist."],
  ["/stock/zero/russian", "Nullbestand bei Russisch glatt."],
  ["/stock/zero/uzbek", "Nullbestand bei Usbekisch wellig."],
  ["/stock/transit", "Ware unterwegs: was bestellt ist und wann es ankommt."],
  ["/stock/transit/russian", "Russisch glatt unterwegs – Mengen und erwartete Ankunft."],
  ["/stock/transit/uzbek", "Usbekisch wellig unterwegs – Mengen und erwartete Ankunft."],
  ["/stock/topseller", "Die Topseller: was sich am besten verkauft."],
  ["/stock/topseller/russian", "Topseller bei Russisch glatt."],
  ["/stock/topseller/uzbek", "Topseller bei Usbekisch wellig."],
  ["/stock/sales", "Verkaufsanalyse: Verkäufe je Produkt und Zeitraum."],
  ["/stock/deadstock", "Ladenhüter: Ware, die lange nicht verkauft wurde und Kapital bindet – Kandidaten für einen Sale."],
  ["/stock/preorders", "Vorbestellungen: was Kundinnen und Kunden schon bestellt haben, bevor die Ware da ist."],
  ["/stock/zubehoer", "Das Zubehörlager mit Beständen."],
  ["/stock/zubehoer/[id]", "Ein einzelner Zubehörartikel mit Bestand und Bewegungen."],

  // Versand & Kunden
  ["/pack", "Die Packliste: offene Shopify-Bestellungen, die gepackt und versendet werden müssen."],
  ["/pack/[id]", "Eine einzelne Shopify-Bestellung zum Packen – Artikel scannen, Foto, versenden."],
  ["/pack/scanner", "Der Scanner zum Packen: Artikel per Barcode prüfen."],
  ["/pack/archive", "Das Archiv der gepackten und versendeten Bestellungen."],
  ["/pack/archive/[id]", "Eine bereits gepackte Bestellung mit Scan-Protokoll und Foto."],
  ["/pack/stats", "Versand-Statistik: gepackte Pakete, Tempo und Fehlerquoten."],
  ["/pack/display", "Die Anzeige für die Packstation."],
  ["/pack/kamera", "Die Beweisfoto-Kamera an der Packstation."],
  ["/pack/print-all", "Alle Lieferscheine bzw. Etiketten gesammelt drucken."],
  ["/pack/zubehoer-code", "Scan-Code für Zubehör zum Ausdrucken."],
  ["/pack/zahlungen", "Zahlungseingänge: Vorkasse-Überweisungen werden mit offenen Bestellungen abgeglichen."],
  ["/pack/kunden", "Kundenanalyse: Umsätze nach Monat, Land, Stadt, Kanal und Kundengruppe."],
  ["/pack/gewerbe", "Gewerbekunden: alle als B2B markierten Kunden – aktiv, inaktiv, tot, nie bestellt – plus „Undercover“-Kandidaten ohne Tag, sortier- und nach Ort gruppierbar."],
  ["/returns", "Retouren: Rücksendungen, Umtausch und Reklamationen mit Status und Bearbeiter."],
  ["/returns/analytics", "Retouren-Analyse: Quote, häufigste Gründe, betroffene Produkte und Lieferanten."],

  // Salon
  ["/salon-admin", "Salon-Verbrauch: welches Material der Salon verbraucht."],
  ["/salon-admin/einnahmen", "Die Salon-Einnahmen, die das Team am iPad erfasst, mit Auswertung."],
  ["/salon-admin/mitarbeiter", "Die Salon-Mitarbeiter mit Zugang und PIN."],
  ["/salon-admin/statistik", "Statistik des Salons: Einnahmen und Verbrauch im Zeitverlauf."],

  // Team
  ["/staff", "Der Mitarbeiter-Bereich."],
  ["/staff/vacation", "Der Urlaubskalender: wer wann frei hat, Anträge, Mindestbesetzung und kritische Zeiträume."],
  ["/staff/sick", "Krankheitstage der Mitarbeiter mit Bescheinigungen."],
  ["/staff/members", "Die Mitarbeiterliste mit Team, Eintritt, Gehalt und Verwarnungen."],

  // Chatbot
  ["/chatbot", "Die Wissensdatenbank des Chatbots: Antworten und Fakten, die der Bot nutzt."],
  ["/chatbot/inbox", "Das Postfach: alle Chats aus Instagram & Co., was offen ist und wo der Bot geantwortet hat."],
  ["/chatbot/inbox/[id]", "Ein einzelnes Chat-Gespräch mit Verlauf, Kategorie und Bot-Antworten."],
  ["/chatbot/insights", "Chat-Insights: worüber Kundinnen und Kunden schreiben und was auffällt."],
  ["/chatbot/lernen", "Hier lernt der Bot vom Team: Vorschläge aus echten Antworten prüfen und übernehmen."],
  ["/chatbot/chat-wissen", "Wissen aus tausenden echten Chat-Verläufen, durchsuchbar."],
  ["/chatbot/appointments", "Termin-Anfragen, die über den Chat reinkommen."],
  ["/chatbot/reservations", "Reservierungen und Warteliste für ausverkaufte Produkte."],
  ["/chatbot/follow-ups", "Nachfass-Nachrichten an Kundinnen und Kunden."],
  ["/chatbot/strategies", "Antwort-Strategien des Bots für verschiedene Situationen."],
  ["/chatbot/training", "Training des Chatbots mit Beispielen."],
  ["/chatbot/guardian", "Der Wächter: Sicherheitsprüfungen, bevor der Bot antwortet."],
  ["/chatbot/word-filters", "Wortfilter für das automatische Lernen des Bots."],
  ["/chatbot/bot-settings", "Einstellungen des Chatbots: wann und wie er antwortet."],
  ["/chatbot/salon-prices", "Salonpreise, die der Bot Kundinnen und Kunden nennen darf."],
  ["/chatbot/avatars", "Die Profilbilder bzw. Avatare des Bots."],
  ["/chatbot/stats", "Chatbot-Statistik: Gespräche, Antwortzeiten, Übergaben an das Team."],
  ["/chatbot/costs", "Was der Chatbot an KI-Kosten verursacht."],
  ["/chatbot/usage", "Token- und Kosten-Monitoring des Chatbots im Detail."],
  ["/chatbot-test", "Testumgebung, um den Chatbot auszuprobieren."],

  // Marketing
  ["/marketing", "Marketing-Übersicht: Kampagnen, Werbeausgaben und Aufgaben des Marketing-Teams."],
  ["/marketing/aufgaben", "Die Aufgaben des Marketing-Teams (HALO)."],
  ["/marketing/aktionen", "Aktionen und Rabattkampagnen mit Zeitraum und Wirkung."],
  ["/marketing/kennzahlen", "Marketing-Kennzahlen: Instagram, Newsletter und Werbeerfolg im Verlauf."],

  // Finanzen
  ["/finances", "Die Finanz-Startseite: Kontostände, Steuern und die wichtigsten Finanzzahlen auf einen Blick."],
  ["/finances/liquiditaet", "Die Liquiditätsvorschau: wie sich der Kontostand in den nächsten Monaten entwickelt – mit Lieferantenzahlungen, Einfuhrabgaben, Steuern und Aktionen."],
  ["/finances/overview", "Monats- und Jahresrechnung: Umsatz, Kosten, Gewinn und die daraus berechneten Steuern, abgeglichen mit dem Finanzamt."],
  ["/finances/prepayments", "Die Steuer-Übersicht: was ans Finanzamt fällig ist, was bezahlt ist und welche Erstattungen ausstehen."],
  ["/finances/bank", "Die Kontoumsätze aller Konten mit Kategorien und Regeln."],
  ["/finances/bwa", "Die BWA (betriebswirtschaftliche Auswertung)."],
  ["/finances/transfers", "Überweisungen und Umbuchungen zwischen den Konten."],
  ["/finances/steuertipps", "Steuertipps: wo sich Steuern legal sparen lassen."],
  ["/finances/z-bons", "Die Z-Bons der Kasse mit Wochencheck."],
  ["/finances/z-bons/scan", "Z-Bon scannen und automatisch erkennen lassen."],
  ["/health", "Der HY-Score: Lagerwert plus Kontostände minus Schulden – wie gesund Hairvenly gerade dasteht."],

  // Verwaltung
  ["/admin/suppliers", "Die Lieferanten mit Stammdaten und Bankverbindung."],
  ["/admin/users", "Die Benutzer des Dashboards mit Rollen und Freigaben."],
  ["/admin/passwoerter", "Der Passwort-Tresor – im Browser verschlüsselt."],
  ["/welt", "Die Hairvenly-Welt: ein 3D-Prototyp mit allen Bereichen."],
];

const MUSTER = SEITEN.map(([pfad, text]) => ({
  re: new RegExp(`^${pfad.replace(/\[[^\]]+\]/g, "[^/]+").replace(/\//g, "\\/")}\\/?$`),
  text,
}));

/** Kurzbeschreibung der Seite oder null, wenn unbekannt. */
export function seitenInfo(pfad: string | null | undefined): string | null {
  if (!pfad) return null;
  const nurPfad = pfad.split("?")[0];
  return MUSTER.find((m) => m.re.test(nurPfad))?.text ?? null;
}
