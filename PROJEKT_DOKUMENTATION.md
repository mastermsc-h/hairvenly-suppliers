# Stock Calculation — Projekt-Dokumentation

**Stand: 23.04.2026**
**Aktuelle CODE_VERSION: `2026-04-23_02-20_FullCandidates-aus-VA-PRODUCT-DATA`**

---

## 1. Was macht dieses Projekt?

Google Apps Script für **Hairvenly** (Haarverlängerungs-Business):
Automatisiertes Inventar-Management-System das
- **Shopify-Lager** täglich abruft
- **Verkaufsdaten** aus Shopify analysiert (30d / 60d / 90d)
- **Topseller-Ranking** pro Collection erstellt
- **Bestellvorschläge** für zwei Lieferanten generiert:
  - **Amanda** — Russisch Glatt (42 Tage Lieferzeit)
  - **China** — Usbekisch Wellig (56 Tage Lieferzeit)
- **Dashboard** mit Übersicht kritischer Bestände zeigt

Alle Logik in einer Datei: `/Users/macbook/hairvenly-inventory/src/Code.js`
Deployment via `clasp push`.

---

## 2. Struktur & Sheets im Spreadsheet

| Sheet | Zweck |
|---|---|
| **Dashboard** | Übersicht Lagerbestand, kritischer Bestand, Unterwegs-Bestellungen |
| **Topseller** | Verkaufsranking letzte 90d, Tier-Zuordnung (TOP7/MID/REST/KAUM), Unterwegs-Spalten pro Bestellung |
| **Vorschlag - Amanda** | Bestellvorschlag Russisch Glatt (obere Tabelle: Budget-Bestellung, untere Tabelle: Idealbestand) |
| **Vorschlag - China** | Bestellvorschlag Usbekisch Wellig (analog) |
| **Verkaufsanalyse** | 30d/60d/90d Verkaufsdaten aus Shopify |
| **Russisch - GLATT** | Shopify-Inventar (russische Produkte) |
| **Usbekisch - WELLIG** | Shopify-Inventar (usbekische Produkte) |
| **DEBUG_CATALOG_V2** | Debug-Ausgabe des CATALOG v1 |
| **DEBUG_VA** | Debug-Ausgabe Verkaufsanalyse |

---

## 3. Ausführungsreihenfolge (Auto-Trigger-Kette)

1. `fetchShopifyInventoryData` — Shopify-Lager abrufen (Batches mit .after()-Triggern)
2. `refreshVerkaufsanalyse` — 30d/60d/90d Verkaufsdaten berechnen
3. `refreshTopseller` — Rankings, Tier-Zuordnung, Lager-Lookup
4. `createDashboard` — Kritischer Bestand, Unterwegs-Übersicht
5. `createBestellungChina` — Bestellvorschlag Usbekisch Wellig
6. `createBestellungAmanda` — Bestellvorschlag Russisch Glatt

**6-Min-Limit**: Google Apps Script limitiert automatische Trigger auf 6 Minuten.
Kette ist in separate `.after()`-Trigger aufgeteilt:
- `fetchShopifyInventoryData` → `autoChain_verkaufsanalyse` → `autoChain_topseller` → `autoChain_dashboard` → `autoChain_china` → `autoChain_amanda`

Setup: `deleteAllTriggers()` + `setupAutoDailyRefresh()` → 2 Trigger (09:00 + 15:00).

---

## 4. CATALOG v1 — Single Source of Truth

Zentrale Struktur: `buildCatalogFromInventory()` liest beide Inventar-Sheets und baut einen Katalog.

**Product-Objekt:**
```javascript
{
  sheetName, collection, fullName, farbeKey,  // Identity
  handle, quality, typ, länge, isPremium,      // Config
  quantity, lager,                              // Inventory
  g30d, g90d, g60d_alt, qty90d,                 // Sales (via joinCatalogWithSales)
  rang, tier                                    // Ranking
}
```

**Handle-Mapping** (Shopify-Handle → Collection):
- `russische-normal-tapes` → Standard Tapes Russisch
- `mini-tapes` → Mini Tapes Glatt
- `bondings-glatt` → Russische Bondings
- `tressen-russisch-classic/genius/invisible` → Tressen
- `clip-extensions` → Clip-Ins (mit Varianten 100g/150g/225g)
- `tapes-45cm/55cm/65cm/85cm` → Usbekische Tapes
- `bondings-65cm/85cm` → Usbekische Bondings
- `tressen-usbekisch-classic/genius` → Usbekische Tressen

---

## 5. Tier-System

Aus Verkaufsrang der letzten 90 Tage innerhalb einer Collection:

| Tier | Rang | Bedeutung |
|---|---|---|
| **TOP7** | 1–7 (bzw. 1–10 bei großen Collections) | Bestseller — dürfen nie ausverkauft sein |
| **MID** | 8–14 (bzw. 11–20) | Mittelfeld |
| **REST** | 15+ | Langsam-Dreher |
| **KAUM** | 0g in 90d verkauft | Regal-Präsenz nur minimal |

**Premium-Flag** für einige Topseller-Collections (erhöhtes Ziel).

---

## 6. Bestellalgorithmus: **DoSA** (Days-of-Stock Allocator)

**Funktion:** `allocateByDaysOfStock_(candidates, budgetG, cfg)`

Entstanden nach Iteration über mehrere Vorgängeralgorithmen. Kern-Idee: **Jedes Produkt soll nach Ankunft der Bestellung eine bestimmte Zielreichweite (42d) haben**.

### 6.1 Grund-Formel (pro Produkt)

```
wunsch = zielReichweite × tagesrate − stock_bei_ankunft

stock_bei_ankunft = Lager + Unterwegs (vor Tag 42) − Verbrauch_bis_Tag42
                    (minimum 0)
```

**Warum 42 Tage?** = 14 Zyklus (alle 14d bestellen) + 28 Safety (Lieferverzug-Puffer).

### 6.2 Phase A1 — Tier-gestaffelter Sockel (Breite vor Tiefe)

Jedes aktive Produkt (tagesrate > 0) bekommt einen **Sockel** abhängig vom Tier:

| Tier | Sockel-Reichweite | Faktor × zielR |
|---|---|---|
| TOP7 | 42d (voll) | 1.0 |
| MID | 28d | 0.67 |
| REST | 14d (1 Zyklus) | 0.33 |
| KAUM | — | 0 (nur Phase B) |

**Zwei Guards:**
1. **Gesamt-Reichweite-Guard**: Wenn `(Lager + ALLES Unterwegs) / tagesrate ≥ 42d` → skip (Produkt hat schon genug, auch wenn stock_at_arrival formal niedrig ist)
2. **KAUM-Filter**: tier="KAUM" kommt nie in Phase A

Sortierung: erst Tier (TOP7 zuerst), dann Dringlichkeit (stock_at_arrival / tagesrate aufsteigend).

**Einheit-sensitive Mindestmenge** (`minSockel: 200`):
- Clip-ins 225g → min 225g (1 Stück)
- Standard Tapes 100g → min 200g
- Mini Tapes 50g → min 200g

### 6.3 Phase A2 — Aufstockung auf 42d (Tiefe)

Produkte, die in Phase A1 bedient wurden, werden bis zum vollen 42d-Ziel aufgestockt. Sortierung: Dringlichkeit.

### 6.4 Phase B — Regal-Präsenz für KAUM

Produkte mit `tagesrate = 0`:
- Amanda: Wenn `Lager + Unterwegs < 300g` → 300g Regal-Bestellung
- China: Wenn `Lager + Unterwegs < 500g` → 500g

### 6.5 Phase C — Überschuss-Reserve (mit Gate)

**Gate:** Phase C läuft NUR wenn alle aktiven Produkte auf zielR (42d) sind.
→ Bei knappem Budget: Gate blockt, kein TOP7-Überpump.
→ Bei reichem Budget: Gate erfüllt, Phase C pumpt auf **tier.maxTage**:

| Tier | maxTage |
|---|---|
| TOP7 | 84d (2 Zyklen Reserve) |
| MID | 70d |
| REST | 56d |

**Weitere Guards in Phase C:**
- Gesamt-Reichweite (Lager + Unterwegs + zugeteilt) ≥ tier.maxTage → skip
- stockOf + zugeteilt über maxTage → skip

Iterative Verteilung: Pro Pass das Produkt mit geringster aktueller Reichweite aufstocken (Schritt = Einheit).

### 6.6 Konfiguration für Amanda

```javascript
zielReichweite: 42,
sockelReichweite: 21,
minSockel: 200,
tierReichweiten: { top: 84, mid: 70, rest: 56 },
regalMindest: 300,
minBestellung: 300,           // Russisch: 300g Mindestbestellung ALLE Tiers
einheitFn: c => c.einheit || 100,
stockBeiAnkunftFn: c.stock_at_arrival
```

### 6.7 Konfiguration für China

```javascript
zielReichweite: 42,
sockelReichweite: 21,
minSockel: 200,
tierReichweiten: { top: 84, mid: 70, rest: 56 },
regalMindest: 500,
minBestellung: 500,           // China: 500g Mindestbestellung
einheitFn: c => 100,
stockBeiAnkunftFn: c.stock_at_84
```

### 6.8 Ausgabe

- **Obere Tabelle**: DoSA-Bestellung innerhalb Budget
- **Untere Tabelle**: "VOLLSTÄNDIGE LISTE (DoSA-Empfehlung bei unbegrenztem Budget)"
  - Nutzt `allocateIdealStock_` (keine Guards, kein Budget-Limit)
  - Erweiterter Kandidaten-Pool via `buildFullAmandaCandidates_` aus VA_PRODUCT_DATA
  - Jedes Produkt: tier.maxTage × rate − (Lager + Unterwegs)

---

## 7. tagesrate-Berechnung (wichtig!)

**Aus Amanda-Flow (korrekt):**
Produkte in `allCandidatesA` haben **ausverkauf-korrigierte tagesrate**:
- Wenn Produkt 15 Tage ausverkauft + 30d-Verkauf 1700g → tagesrate = 1700/15 = 113/d (nicht 1700/30 = 57/d)
- Verwendet `g60d_alt` (Verkäufe im mittleren 60d-Zeitfenster ohne Out-of-Stock)

**Aus VA_PRODUCT_DATA (einfacher):**
`buildFullAmandaCandidates_` nutzt `p.g30d / 30` — **ohne Ausverkauf-Korrektur**.
→ Tagesrate dort oft **deutlich niedriger** als im Amanda-Flow.

**Konsequenz:**
- Obere Tabelle hat korrekte, realistische Raten (aus Amanda-Flow)
- Untere Tabelle (VOLLSTÄNDIGE LISTE) nutzt einfachere VA-Rate
- Wenn man VA-Erweiterung auch für obere Tabelle nimmt → Raten werden halbiert → Bestellungen halbiert → Budget wird nicht ausgenutzt.

**Aktuelle Lösung:** Trennung strikt halten. Obere = Amanda-Flow. Untere = Erweitert aus VA.

---

## 8. Farb-Extraktion & Matching

### 8.1 `extractFullColor_(productName)`

**GLOBAL** definiert. Extrahiert vollständigen Farbnamen bis zum ersten Stopword.

- `"TRESSEN #LATTE BROWN RU GLATT CLASSIC WEFT"` → `"#LATTE BROWN"`
- `"#LATTE BROWN - KÜHLES HELLBRAUN STANDARD..."` → `"#LATTE BROWN"`

**Stopwords:** RU, US, RUSSISCH, GLATT, WELLIG, TAPE(S), BONDING(S), TRESSEN, CLASSIC, GENIUS, INVISIBLE, WEFT, MINI, EXTENSIONS, ECHTHAAR, CLIP, KERATIN, BUTTERFLY, STANDARD, 45CM-85CM, 1G, 0.5G, HAAR

**Kritisch:** Überall `extractFullColor_` verwenden, NICHT `colorRaw.split(" ")[0]`! Sonst werden `#LATTE BROWN` und `#LATTE BALAYAGE` verwechselt.

### 8.2 `matchColor(itemColor, productUpper)`

- Normalisiert beide Seiten via `normalizeColorStr_` + `applyColorAliases_`
- Bidirektionaler Präfix-Match

**Bekannte Aliases:**
- NORWEGIAN → NORVEGIAN
- CAPPUCINO → CAPPUCCINO (Tippfehler in Bestell-Tabs)
- BISQUID → BISCUIT
- MOCHAMELT → MOCHA MELT

### 8.3 Clip-in Suffix

Regex `/\s*\[\d+\s*G\]\s*$/i` entfernt `[100G]`, `[150G]`, `[225G]` Suffixe aus Farben.

---

## 9. Unterwegs-Bestellungen

### 9.1 Bestellungs-Tab Format-Erkennung

- **V3 mit V1-Daten**: Header `["Quality","Method","Length/Variant","Farbcode"]` → 5 Spalten (E=Quantity)
- **V3 mit V2-Daten**: Header `["Method","Length/Variant","Farbcode","Quantity (g)"]` → 4 Spalten
- Erkennung: `B1.includes("status")` (NICHT A1!)

### 9.2 Status-Erkennung: `getOrderStatusFromTab(sheet)`

Prüft B2 für:
- `angekommen, abgekommen (Tippfehler), eingetroffen, geliefert` → eingetroffen (nicht mehr unterwegs)
- `entwurf, storniert` → nicht gezählt
- `unterwegs, bestellt, verzollung` → aktiv unterwegs
- Fallback: "aktiv"

### 9.3 `stock_at_42` / `stock_at_arrival`

Simulierter Lagerbestand bei Ankunft der neuen Bestellung (Tag 42 für Amanda, Tag 84 für China):
- Nur Unterwegs-Ware die VOR diesem Tag ankommt wird gezählt
- `stock = Lager + Unterwegs_rechtzeitig − Verbrauch_bis_Ankunft`
- Min 0 (gekappt)

---

## 10. Regeln die User festgelegt hat

### 10.1 Bestellzyklus & Lieferzeiten
- **Alle 14 Tage** wird bestellt — feststehend!
- Amanda-Lieferzeit: 42 Tage (echte Erfahrungswerte, teils auch 36+ Tage Verzug)
- China-Lieferzeit: 56 Tage
- Ziel-Reichweite = 14 Zyklus + 28 Safety = 42 Tage

### 10.2 Budget-Regeln
- **Russisch (Amanda)**: Mindestbestellung 300g für ALLE Tiers (nicht 500g wie früher!)
- **China**: Mindestbestellung 500g
- Budget-Eingabefeld in jeder Bestelltabelle (Spalte J/I)
- Empfehlungs-Budget ("2-Wochen-Bedarf") = (50% Ø3M + 50% g30d) × 0.5

### 10.3 Bestell-Prioritäten (vom User mehrfach betont)
1. **Topseller dürfen keine Lücke haben** — bei Budget-Knappheit TOP7 zuerst
2. **KAUM mit Unterwegs-Bestand bekommt NICHTS** (auch nicht 100-200g Regal-Aufstockung, wenn schon genug unterwegs)
3. **REST mit genug Unterwegs bekommt NICHTS**
4. Bei reichem Budget: alle Kategorien ausgleichen (nicht nur TOP7 auf 84d pumpen während REST leer)

### 10.4 Clip-ins 225g
- Clip-ins 225g sind physische Einheit = 1 Packung = 225g
- Mindestbestellung muss **einheit-sensitiv** sein: 225g = 1 Stück (nicht mehr 500g = 2.2 Stück)

### 10.5 Unterwegs-Timing (korrigiert 23.04.2026)
- Lieferungen 03.02, 03.03, 10.03 kommen ALLE **morgen gleichzeitig** an (wegen Verzug)
- 07.04-Bestellung kommt regulär ~27d später
- `stock_at_arrival` berücksichtigt Unterwegs nur bis Tag 42 — was später ankommt zählt nicht

---

## 11. Dashboard

**Unterwegs-Details:**
- Chart + Übersicht werden NACH den Detailspalten platziert
- `INFO_COL = DETAIL_START_COL + maxDetailCols + 1`
- Details standardmäßig sichtbar (Checkbox auf true, Spalte N2)

**Kritischer Bestand:**
- Produkte mit Lager+Unterwegs < geplanten Verbrauch bis Ankunft

---

## 12. Topseller-Tab Struktur

Pro Quality (Russisch Glatt / Usbekisch Wellig) → pro Typ+Länge (Section):
- Rang, Produkt (vollständiger Shopify-Name), Länge, Verkauft(g) 90d, 30 Tage (g), Verkauft (Stk), **45/60 Tage Verbrauch** (Prognose), Tier, Ziel(g), Lager(g), Rang-Klasse, Unterwegs(g) Gesamt
- **Detail-Spalten pro aktive Bestellung** (Datum + Ankunft als Header, Menge pro Produkt in Zelle)

**Daten-Speicherung:**
- `TOPSELLER_DATA`: {quality: {typKey: {farbeKey: {tier, rang}}}}
- `TOPSELLER_DATA_V2`: {quality: {typKey: {farbeKey: {tier, rang, lager, fullName}}}}

---

## 12a. Ankunftszeiten — wie werden sie berücksichtigt?

**Wichtige Frage die der User wiederholt stellt:** Beachtet der Algorithmus wann die Unterwegs-Lieferungen tatsächlich ankommen, oder zählt er alle Unterwegs-Mengen pauschal?

### Antwort: Teilweise, NICHT durchgehend

**Für Amanda-Flow-Kandidaten** (= Produkte aus Shopify-Inventar, ~25 Stück):
- `stock_at_42` / `stock_at_arrival` wird **echt berechnet**
- `getUnterwegsDetailsForProduct(allOrders, ...)` liefert Array `[{date, menge}]`
- Unterwegs-Ware die VOR Tag 42 ankommt → zählt ins stock_at_arrival
- Unterwegs-Ware die NACH Tag 42 ankommt → zählt NICHT (kommt ja erst nach Ankunft der neuen Bestellung)
- Beispiel: 03.02-Bestellung mit regulärer Ankunft 17.03 → bei Planung heute zählt sie, weil sie vor Tag 42 ankommt
- 07.04-Bestellung mit Ankunft 19.05 (27 Tage nach heute) → zählt NICHT wenn Ziel-Ankunft heute+42d

**Für neu hinzugefügte VA-Kandidaten** (Clip-ins 225g, Invisible Weft etc., via `buildFullAmandaCandidates_`):
- `stock_at_arrival = null` gesetzt
- Fallback: `lager + ALLES Unterwegs` (egal wann es ankommt)
- ⚠️ **Lieferverzüge/Timing werden NICHT berücksichtigt**
- Funktion holt nur `getUnterwegsForProduct` (Summe ohne Datumsinfo)
- Konsequenz: Wenn eine große Unterwegs-Ladung erst in 60d ankommt, wird sie trotzdem so behandelt als wäre sie bei Ankunft der neuen Bestellung (Tag 42) schon im Lager. Das überschätzt den verfügbaren Bestand → zu wenig wird bestellt

### Lieferverzugs-Handling (Stand 23.04.2026)

- Amanda 03.02, 03.03, 10.03 Bestellungen waren ursprünglich ~36 Tage verspätet
- Ankunft laut User: "kommen morgen alle gleichzeitig" (April 2026)
- Der Code liest aus den Bestellungs-Tabs das Datum (`getOrderedWeightForProduct`) — wenn dort das korrigierte Datum steht, wird es berücksichtigt
- Für Topseller-Tab Detail-Spalten wird Bestelldatum + 42d als "ca. Ankunft" angezeigt (nicht das echte korrigierte Datum)

## 13. Aktuelle Schwierigkeiten (offene Punkte)

### 13.1 KRITISCH: Unterschiedliche Tagesraten
- **Amanda-Flow** (obere Tabelle): ausverkauf-korrigierte tagesrate aus `g60d_alt` → realistisch
- **VA_PRODUCT_DATA** (untere Tabelle): simple `g30d / 30` → oft 50% niedriger

Wenn VA-Erweiterung auch für obere Tabelle genutzt wird, halbieren sich die Bestellmengen. Aktuelle Lösung: strikte Trennung (obere = Amanda-Flow, untere = VA-erweitert).

### 13.2 Fehlende Kandidaten in oberer Tabelle
Clip-ins 225g TOP7 (SMOKY BROWN, BITTER CACAO, LATTE BALAYAGE etc.) und Invisible Weft TOP7 (Ebony, Cool Toned) tauchen **nicht im Shopify-Inventar-Sheet** auf (Lager=0) → werden nicht als Kandidaten in `allCandidatesA` aufgenommen → obere Tabelle kann sie nicht bestellen.

**Ungelöst**: Wie diese Produkte mit **korrekter ausverkauf-korrigierter Rate** in `allCandidatesA` bekommen, ohne die bestehenden Raten zu überschreiben?

### 13.3 Dedupe-Problem bei buildFullAmandaCandidates_
Bei Clip-ins konnte Dedupe zwischen verschiedenen Varianten (100g/150g/225g) unsauber greifen — gleiche Farbe, andere Einheit → Dubletten möglich.
`normalizeFarbe` entfernt `[150g]`/`[225g]` Suffix + `- INVISIBLE...` Endung. Noch nicht perfekt geprüft.

### 13.4 Budget-Ausschöpfung
Bei 50kg Budget verbraucht DoSA nur ~22-27kg. Grund: Nur ~25 Kandidaten im Pool, die haben bei 84d-Reichweite keinen größeren Bedarf mehr. Für echte Ausschöpfung müssten fehlende Kandidaten (s. 13.2) rein.

### 13.5 Phase C Gate
Phase C pumpt nur wenn alle aktiven Produkte auf 42d. Wenn ein einziges Produkt nicht ganz auf 42d kommt (Einheit-Rundung, Budget-Knappheit), skippt Phase C komplett → Budget liegt brach.

### 13.6 VA_PRODUCT_DATA vs. Topseller-Tab — inkonsistente g30d-Werte
**Konkreter Bug beobachtet bei SMOKY BROWN Clip-ins 225g:**
- Topseller-Tab zeigt 30d-Verkauf = 675g (PDF Stand 22.04.2026)
- VA_PRODUCT_DATA hat offenbar g30d ≈ 321g (rate 10.7/d im unteren Tabellen-Idealbestand sichtbar)
- Differenz erklärt warum das Produkt im DoSA als "fast genug" behandelt wird (Gesamt-Reichweite 42d mit 450g Unterwegs), obwohl es laut Topseller-Tab klar Topseller ist

Beide Datenquellen sollten aus derselben Shopify-Sales-API kommen, unterscheiden sich aber in:
- Zeitfenster (genaues Start-/Endrand)
- Variant-Erkennung (Clip-ins-Gewichte)

**Konsequenz:** Topseller zeigt TOP7, DoSA behandelt als REST/KAUM → Phase A springt → nichts bestellt.

### 13.7 Lieferverzüge bei VA-Kandidaten
`buildFullAmandaCandidates_` nutzt `getUnterwegsForProduct` (pauschale Summe, kein Timing).
→ Wenn 450g unterwegs sind aber erst in 60 Tagen ankommen (nach Tag 42), werden sie trotzdem als "verfügbar bei Ankunft" behandelt → Algorithmus denkt es ist genug da → bestellt nicht.

**Fix wäre:** `getUnterwegsDetailsForProduct` verwenden + stock_at_42-Simulation auch für VA-Kandidaten. Aber komplex (Date-Handling pro Bestellung).

---

## 14. Push-Prozess

Nach jedem `clasp push` CODE_VERSION aktualisieren:
```
CODE_VERSION = "YYYY-MM-DD_HH-MM_kurzbeschreibung"
```

Oben im Code als Marker + bei Funktionsstart via:
```javascript
Logger.log("🏷️ CODE_VERSION: " + CODE_VERSION)
```

Damit User verifizieren kann ob der aktuelle Code läuft.

**Push-Befehl:**
```bash
NODE_OPTIONS="--dns-result-order=ipv4first" npx clasp push
```

---

## 15. Bekannte technische Besonderheiten

### 15.1 Chunked Storage
`PropertiesService` hat 9KB-Limit pro Property. Große Objekte werden in Chunks aufgeteilt:
- `saveChunked_(props, baseKey, obj)` → `baseKey_0`, `baseKey_1`, ... + `baseKey_COUNT`
- `loadChunked_(props, baseKey)` → liest alle Chunks zusammen

### 15.2 Trigger-Flut
`.after()`-Trigger die fehlschlagen bleiben als deaktivierte "Leichen" zurück.
Workaround: `deleteAllTriggers()` + `setupAutoDailyRefresh()` bei > 6 Shopify-Fetch-Triggern.

### 15.3 safeAlert_
UI-Alerts crashen bei Auto-Trigger (kein UI verfügbar).
Helper `safeAlert_(msg)` fängt das ab.

### 15.4 Format-Erkennung V3
**V3 mit V1-Daten**: Header `["Quality","Method","Length/Variant","Farbcode"]` → 5 Spalten (E=Quantity)
**V3 mit V2-Daten**: Header `["Method","Length/Variant","Farbcode","Quantity (g)"]` → 4 Spalten
Parser erkennt anhand Header-Zeile.

---

## 16. User-Instruktionen (aus Memory)

### Kernregel
**Jede Frage beantworten. Anweisungen direkt umsetzen, nicht eigene Varianten erfinden.**

### Konkret
1. Wenn User eine Frage stellt → sofort beantworten, nicht weiter spekulieren
2. "Nimm die vollen Shopify-Namen" → direkt aus dem Shopify-Tab ziehen, kein Lookup-System bauen
3. "Das Problem war vorher nicht da" → ernst nehmen, als Datenpunkt verwenden
4. Bei Zweifeln kurz nachfragen statt monologisieren
5. Bestätigen wenn Anweisung verstanden
6. Nie endlos debuggen ohne Daten — nach 2 Versuchen: Debug-Log oder konkrete User-Daten einfordern

### Feedback-Auslöser (16.04.2026)
Topseller Lager-Matching-Bug. User hat mehrfach gesagt "nimm die Daten aus dem Shopify-Tab", stattdessen kompliziertes Lookup-System → 3+ Runden im Kreis. Der Fix war ein Einzeiler (`[100G]`-Suffix aus Farbe entfernen).

### Lehre für jetzt (23.04.2026)
User hat mehrfach "nicht zu viel an Architektur ändern" und "keine Ratespielchen" gesagt.
Lehre: Nicht fünf Änderungen hintereinander ohne Test. Bei Unsicherheit User fragen welche Version beibehalten werden soll, statt weiter zu "fixen".
