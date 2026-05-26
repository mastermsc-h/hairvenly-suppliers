# Hairvenly-Chatbot — Architektur, Prinzipien, gelöste Bug-Klassen

> ⚠️ **IMMER LESEN bei jeder Änderung am Chatbot.** Diese Datei ist das
> Gedächtnis des Projekts — sie verhindert, dass dieselben Bug-Klassen
> immer wieder neu "entdeckt" und neu "vorgeschlagen" werden.
>
> 📊 **Visuelle Übersicht:** [CHATBOT_FLOW.md](./CHATBOT_FLOW.md) — Mermaid-
> Diagramme zur Pipeline, Sanitizer-Chain, Datenfluss, Cost-Modell.

---

## 🚨 Top-Regel: Löse wie ein echter Informatiker-Architekt

**Architekt-Denken** heißt: Weitsicht + Wirtschaftlichkeit + Skalierbarkeit.
NICHT: warten bis es brennt, dann Pflaster drauf.

Bei JEDEM Bug, BEVOR irgendwelcher Code angefasst wird:

1. **Bug-Klasse identifizieren** — nicht den einzelnen Fall.
   „Adresse halluziniert" ist kein Bug — die Klasse ist „Bot erfindet Fakten,
   die wir in der DB haben". Auch „5P18A nicht erkannt" gehört in dieselbe Klasse.

2. **In §3 (gelöste Bug-Klassen) nachschauen.** Wenn die Klasse schon
   gelöst ist → existierendes Pattern anwenden, NICHT neu erfinden.

3. **Strukturelle Invariante suchen.** Eine Regel, die alle Varianten der
   Klasse strukturell abdeckt — NIE Varianten enumerieren.

4. **🌳 SIBLING-CASE-SWEEP — PFLICHTSCHRITT vor jeder Implementierung.**
   *„Welche 3 verwandten Fälle würde derselbe Root-Cause noch produzieren?
   Sind die mit derselben Lösung erschlagen?"*

   Beispiele wo das DIESEN Fix erweitert:
   - „Bot bestätigt falsche Straße" (Hans-Bernhard) → Sibling-Sweep fragt:
     **was wenn Kundin falsche Telefonnummer/Email/PLZ/Öffnungszeit nennt?**
     → ALLE Contact-Intent-Klassen brauchen Korrektur-Variante, nicht nur Adresse.
   - „Bot lügt über Tape 65cm" → Sibling-Sweep fragt:
     **was wenn Bot über Linien-Verfügbarkeit lügt? Über Preise? Über Stock?**
     → Validator muss diese Klassen mitabdecken, nicht nur Method×Length.
   - „Bot fragt redundant 'Welche Methode?'" → Sibling-Sweep fragt:
     **welche anderen redundanten Schluss-Fragen gibt es?**
     → „Möchtest du…", „Soll ich…", „Brauchst du noch…" → Pattern broadenen.

   Diese Schritte sind **PFLICHT** — wenn du nur den genannten Fall fixt
   und 3 verwandte Fälle übrig lässt, ist es ein Pflaster.

   Wenn dir partout kein Sibling einfällt → notiere im Commit
   „Sibling-Sweep: keine verwandten Fälle identifiziert" — das zeigt,
   dass du den Schritt absichtlich gegangen bist, nicht vergessen hast.

4. **Drei Architekt-Dimensionen prüfen, bevor implementiert wird:**

   **🔭 WEITSICHT** — *"Was lädt dieser Fix für die nächsten 3 Bugs ein?"*
   - Welche neue Klasse von Folgefehlern wird durch die Lösung möglich?
   - Wo entsteht Schuld, die später bezahlt werden muss?
   - Welche zwei verwandten Bugs lösen wir IM GLEICHEN Zug mit?
   - Beispiel: Pre-LLM-Inject für Farben → gleiche Schicht ist auch
     für Stock / Stylistinnen / Versandkosten anwendbar — bauen wir
     gleich generisch genug?

   **💰 WIRTSCHAFTLICHKEIT** — *"Was kostet dieser Fix pro Anfrage?"*
   - Wieviele Tokens fügt er zum Prompt hinzu? (jedes neue System-Block
     kostet $$ × 500 Nachrichten/Tag × 365)
   - Spart er Tokens an anderer Stelle? (z.B. FAQ rauswerfen wenn
     Pre-LLM-Inject die Frage schon beantwortet)
   - Verhindert er einen Refine-Round-Trip? (Refine kostet einen
     ganzen zweiten LLM-Call)
   - Cache-Stabilität: bricht der Fix den 1h-Prompt-Cache? (jeder
     dynamische Inhalt ganz oben im Prompt killt den Cache → +$0.15/call)
   - Faustregel: **3ct/Anfrage Hard-Cap.** Wer drüber liegt, muss
     einen anderen Hebel finden.

   **📈 SKALIERBARKEIT** — *"Hält der Fix bei 10x Last?"*
   - Heute 500 msg/Tag — morgen 5000? bei 5000 noch dieselbe Architektur?
   - Skaliert die Lösung linear mit Anzahl FAQs / Trainings / Sessions?
     Wenn ja → das ist Schuld, nicht Lösung (Bsp: alle 500 FAQs in
     jedem Prompt = unbezahlbar).
   - Braucht jeder neue Fall menschliches Eingreifen? Dann skaliert
     er NICHT.
   - Race-Conditions: greift der Fix auch bei 100 Webhooks pro Minute?
     (Bsp: Latest-Wins-Guard schon — independent Timer-Pattern nicht.)

5. **Erst dann implementieren.** Keine Pflaster, keine zusätzliche FAQ als
   Erstlösung, keine "noch eine Sanitizer-Regel".

**Anti-Muster (NIE machen):**
- ❌ „Wir fangen auch diese Variante mit ab"
- ❌ „Ich schreibe eine FAQ, die dem Bot sagt er soll Tool X aufrufen"
- ❌ „Defensive Doppel-Absicherung an Stelle Y"
- ❌ „Den Edge-Case behandeln wir später"
- ❌ „Reaktiv: erst wenn's brennt, dann fixen"
- ❌ „Token-Kosten checken wir später"
- ❌ „Skaliert bei 5000 msg/Tag schauen wir uns dann an"

**Faustregel:** Wenn ein Fix unter einer der drei Dimensionen (Weitsicht /
Wirtschaftlichkeit / Skalierbarkeit) durchfällt → ist es ein Pflaster,
keine Lösung. Zurück zu Schritt 3.

---

## 🛡 ZERO-REGRESSION-GARANTIE (zusätzlich nicht-verhandelbar)

**User-Feedback (2026-05):** *„Aber nicht, dass dadurch etwas kaputtgeht
oder schlechter wird. Immer wenn du was machst, sicherstellen dass der
Bot qualitativ besser wird, statt die Gefahr dass es schlechter wird!"*

Bei JEDER Änderung am Live-Bot-Pfad gilt:

1. **Beweise zuerst, dass es besser ist — dann switchen.**
   Nie umgekehrt. Kein „wir testen es live und sehen schon".

2. **Bei größeren Refactors (Router, neue Pipeline, neuer LLM-Pfad):**
   ZWINGEND Shadow-Mode-Phase vor Switch:
   - Neue Logik läuft PARALLEL zur alten
   - Antwortet aber NICHT live an Customer
   - Loggt die hypothetische Antwort + die echte Bot-Antwort
   - Mind. 24-48h Datensammlung
   - Vergleich: ist die neue Antwort objektiv besser (kürzer / korrekter /
     deterministischer) oder Gleichstand? → switchen. Schlechter? → fix.

3. **Feature-Flags pro Komponente** — never big-bang.
   Jeder Handler/Pipeline-Teil einzeln on/off.

4. **Konfidenz-Schwellwerte + Fallback auf alten Pfad** bei jeder
   neuen Logik. Wenn Konfidenz < Schwelle → alter Pfad. Kein neuer
   Failure-Modus.

5. **Smoke-Test-Suite** vor jedem Deploy: kanonische Eingaben
   („Habt ihr 5P18A?", „Adresse?", „Termin Montag?") MÜSSEN
   weiterhin korrekt beantwortet werden. Refactor darf keinen
   etablierten Fall brechen.

6. **Rollback in <1 Min möglich**: Feature-Flag zurücksetzen, fertig.
   Keine Migration die nur in eine Richtung geht.

**Anti-Pattern** (NIE):
- ❌ „Lass uns das mal live testen, ist ja besser als der alte Code"
- ❌ „Der neue Pfad sollte funktionieren, deploy ich mal"
- ❌ „Wenn was schiefgeht rollback ich"
- ❌ Big-Bang-Refactor ohne Shadow-Phase

**Faustregel:** Wenn du nicht beweisen kannst, dass die Änderung
mindestens neutral ist (idealerweise besser), darfst du sie nicht
live deployen. Punkt.

---

## 1. Drei nicht-verhandelbare Architektur-Prinzipien

### 1.1 Pre-LLM-Inject statt LLM-Decide

**Problem:** LLMs sind nicht-deterministisch. Eine Anweisung im Prompt
("rufe immer Tool X auf, bevor du sagst kennen wir nicht") wird unter
hoher Token-Last manchmal ignoriert. Wir können nicht 1000 Regeln
gleichzeitig garantieren.

**Lösung:** Bei Fakten, die wir in unseren Systemen haben:
1. Pre-LLM-Detektor erkennt das Pattern in der Customer-Message (Regex/Heuristik).
2. Wir machen den DB-Lookup SELBST.
3. Das Ergebnis wird als System-Kontext in den Prompt gepackt.
4. Bot wird zum Wordsmith über fertigen Daten, nicht zum Entscheider.

**Existierende Implementierungen:**
| Domäne | Datei | Pattern |
|---|---|---|
| Adresse/Phone/Mail/Öffnungszeiten | `src/lib/chatbot/intent-contact.ts` | Detect intent → Template aus `business-config.ts` |
| Methoden × Längen | `src/lib/chatbot/respond.ts` → `loadProductCatalog()` | Komplette Matrix als System-Block |
| Farbcodes (5P18A, 4/27…) | `src/lib/chatbot/intent-color-codes.ts` | Regex detect → product_colors-Lookup → System-Hint |

**Kandidaten, die noch fehlen** (in Reihenfolge der Bug-Häufigkeit):
- [ ] Stock-Status pro Methode (häufig: Bot sagt "vorrätig" obwohl nicht)
- [ ] Stylistinnen-Namen (Bot erfindet manchmal Namen)
- [ ] Versandkosten / Preise (manchmal falsch zitiert)

**Heuristik:** Wenn der Bot dieselbe Faktenklasse 2× falsch beantwortet → Pre-LLM-Inject bauen, NICHT FAQ schreiben.

### 1.2 Latest-Wins statt unabhängige Timer

**Problem:** Mehrere parallele Webhooks → jeder startet eigene Debounce-Clock
→ alle feuern → Spam.

**Lösung:** Nach Debounce zusätzlich SQL-Check
„Hat zwischen MEINER Customer-Message und JETZT bereits jemand
(Bot/Mensch/parallel-Webhook) geantwortet?" → ja → skip.

**Folge:** Egal wie viele Customer-Messages innerhalb des Debounce-Windows
ankommen — es gibt IMMER nur EINE Bot-Antwort.

**Code:** `src/app/api/webhooks/meta/route.ts` — Block ab `LATEST-WINS GUARD`.

**Beim Bauen neuer Trigger:** dieses Muster ÜBERNEHMEN, nicht neu erfinden.

### 1.3 Structural Invariants statt Varianten-Enumeration

**Problem:** „Bot schreibt Parkallee 106"  → fix. „Bot schreibt Haferwende 1"
→ fix. „Bot schreibt Buchtstraße 8" → fix. So nicht.

**Lösung:** EINE Regel pro Pattern-Klasse, die strukturell hält.

**Beispiel Adress-Sanitizer:**
```ts
// Matcht JEDE deutsche Adresse, NICHT spezifische Straßen
const anyAddress = /\b([A-ZÄÖÜ][^\n,;]{2,60}?)\s+(\d{1,4}[a-z]?),?\s*(\d{5})\s+([A-ZÄÖÜ][\wäöüß.-]+)\b/gi;
// → ersetzt jede gefundene Adresse durch BUSINESS_CONFIG.address_oneline
```

Ein Match deckt unendlich viele Halluzinations-Varianten ab.

### 1.4 Niemals Autobot bei Risiko-Kategorien

Folgende Kategorien dürfen NIE automatisch beantwortet werden
(`isHighConfidence` returns false):

- `color_advice` — Foto-Empfehlung braucht Mensch
- `gewerbe` — B2B-Lead darf nicht verloren gehen
- `appointment` — Kalender bisher manuell

**Code:** `src/app/api/webhooks/meta/route.ts` → `isHighConfidence()`.

Wenn eine neue Risiko-Kategorie auftaucht → hier ergänzen, nicht "case-by-case" lösen.

---

## 2. Bereits gelöste Bug-Klassen — NICHT NEU ERFINDEN

> Wenn ein Bug-Report reinkommt: ZUERST hier nachsehen, OB die Klasse
> schon gelöst ist. Wenn ja → existierendes Pattern wiederverwenden.

| Datum | Bug-Klasse | Pattern | Code-Ort |
|---|---|---|---|
| 2026-04 | Bot halluziniert Adresse/Phone/Mail | Pre-LLM Bypass + Post-Sanitizer + Stream-Korrektur-Event | `intent-contact.ts`, `output-sanitizers.ts`, web-chat `text_replace` SSE |
| 2026-04 | Bot mischt Methoden×Längen aus verschiedenen Linien | Catalog-Matrix als System-Block + Validator gegen tool_results | `loadProductCatalog()`, ETA-Validator in `respond.ts` |
| 2026-04 | Bot bietet proaktiv Foto/Video an | Stripper: nur reaktiv erlaubt | `stripProactivePhotoOffer` |
| 2026-04 | Klammer-Disclaimer am Ende ("_Kurz:…_") | Self-referenzieller Disclaimer-Stripper | `stripSelfReferentialDisclaimer` |
| 2026-04 | „gleich" außerhalb der Öffnungszeit | Business-Hours-aware Sanitizer | `scrubClosedHandover`, `scrubWeekendTrap` |
| 2026-04 | URL-Mismatch Farbname↔URL | Stripper auf hairvenly.de/products | `stripColorUrlMismatch` |
| 2026-04 | „Auto-Entwurf" / „MA übernommen" verwirrend | Renaming → „Assistiert" / „Markiert" | inbox-UI + `setBotMode` |
| 2026-05 | Self-Trigger (3 Bot-Antworten in 14s ohne Customer-Msg) | Anti-Self-Trigger-Guard <30s | `respond.ts` Block „SELF-TRIGGER-GUARD" |
| 2026-05 | Gewerbe-Lead automatisch beantwortet | B2B-Detector + force `opts.assisted=true` + `isHighConfidence` blacklist | `respond.ts` „B2B-DETECTOR" + `meta/route.ts` |
| 2026-05 | Mehrere Bot-Antworten weil Customer 3 Messages in 90s schickt | Latest-Wins-Guard (SQL-Check „jemand schon geantwortet seit my-msg?") | `meta/route.ts` „LATEST-WINS GUARD" |
| 2026-05 | Markdown-Sterne (`**bold**`) literal in WhatsApp sichtbar | `stripMarkdownFormatting` als letzter Sanitizer | `output-sanitizers.ts` |
| 2026-05 | Bot sagt „kenne ich nicht" zu existierendem Farbcode | Pre-LLM Color-Code-Injector (Regex+Lookup) | `intent-color-codes.ts` |
| 2026-05 | Bot LÜGT über Existenz einer Variante TROTZ injizierter Daten („Tape 65cm gibt es generell nicht" obwohl in DB) | Negative-Claim-Validator als Post-LLM-Sanitizer + verschärfte Hint-Sprache („VOLLSTÄNDIGE Liste, jede Negativ-Aussage muss durch Liste oben gestützt sein") | `intent-color-codes.ts` → `validateNegativeClaims` |
| 2026-05 | Bot bestätigt FALSCHE Adress-Annahme der Kundin („Hans-Bernhard? Genau, richtig — Hans-Böckler-Straße 60") | `address_correction`-Intent: detect fremden Straßennamen/PLZ → Korrektur-Template „Fast — wir sind in der …" | `intent-contact.ts` |
| 2026-05 | Bot fragt redundant „Welche Methode/Länge suchst du?" nach exhaustiver Liste | `stripRedundantFollowupQuestion` Sanitizer (≥3 Bullets + trailing Fragen-Pattern → strip) | `output-sanitizers.ts` |
| 2026-05 | Debounce zu kurz für reale Customer-Tippzeit (Foto-Upload 2-4 Min) | Debounce 90s → 240s (normal) / 60s (kurz); via Latest-Wins immer noch nur eine Antwort | `webhooks/meta/route.ts` |
| 2026-05 | Action-Bar im Inbox-Header rechts abgeschnitten | `flex-wrap` hinzugefügt | `session-view.tsx` |
| 2026-05 | Delete-Button pro Message nur bei Hover sichtbar | `opacity-30 → group-hover:100` (vorher 0) + größeres Icon | `session-view.tsx` |
| 2026-05 | **Web-Chat-Pipeline hatte nur enforceBusinessFacts, ALLE anderen Sanitizer fehlten** (Task #137-Schuld). Erscheinung: Bot-Test-Page in Dashboard zeigt verbose Output + ungestrippte Negativ-Lügen, obwohl Webhook-Pipeline alles fixt | Komplette Sanitizer-Pipeline in `/api/chat/route.ts` einbauen (gleiche Reihenfolge wie respond.ts: enforce → validate → applyAllOutputSanitizers → text_replace SSE) | `api/chat/route.ts` |
| 2026-05 | Pre-LLM-Injektor sah nur die aktuelle Customer-Message → Folge-Fragen wie „tapes. zeig mir das produkt" injizierten nichts, weil Code "2T18A" nur 2 msg vorher stand. Bot listete 2 von 4 Varianten aus Eigengedächtnis. | `applyPreLlmContext(prompt, currentMsg, recentHistory?)` — Pipeline akzeptiert jetzt optionale History; beide Routes laden letzte 5 Customer-Messages | `pipeline.ts`, `respond.ts`, `api/chat/route.ts` |
| 2026-05 | `stripRedundantFollowupQuestion` feuerte erst ab 3 Bullets → kleinere 2-Optionen-Listen kamen mit „Welche willst du?"-Frage durch | Schwelle von 3 auf 2 gesenkt; User-Rule: ab 2 visible Optionen entscheidet Kundin selbst | `output-sanitizers.ts` |
| 2026-05 | **Bot schreibt Adresse OHNE PLZ → enforceBusinessFacts greift nicht** („Hans-Böckler-Straße **59** in Bremen" — falsche Hausnummer durchgelassen) | Pattern B (Straße+Nummer ohne PLZ) + Pattern C (Straße ohne Nummer) + `i`-Flag (case-insensitive Suffix-Match) + Suffix-Liste um Wende/Pfad/Ufer/Damm/Stieg/Twiete/Markt/Park/Hof erweitert | `intent-contact.ts` → `enforceBusinessFacts` |
| 2026-05 | `booking_note` „Am besten kurz vorher Bescheid geben…" klang wie Pflicht-Aufforderung | User-Wording übernommen: „Wenn du von weiter weg kommst und nicht umsonst herfahren willst, frag vorher kurz nach…" — als hilfreicher Tipp, nicht Pflicht | `business-config.ts` |
| 2026-05 | **detectContactIntent matched bei „str." nicht — `[^.\n]` schließt Punkt aus → Regex springt nicht über „str." hinweg → Bot landete im LLM-Pfad und rief HANDOFF-Tool für Adress-Frage** | `[^.\n]` → `[^\n]`; `\b<Suffix>\b` → `\b\w*<Suffix>\b` (für „parkallee"/„haferwende"); 3. Pattern für Straße + Satz-end-Frage; **Handoff-Tool blockt Calls bei Contact-Intent** → spielt Template aus statt Stylistin zu rufen | `intent-contact.ts`, `tools/index.ts` |
| 2026-05 | **Smoke-Test-Baseline aufgedeckte Detect-Bugs** (30 kanonische Cases): `\b<Keyword>\b` matched Komposita nicht („telefonnummer", „öffnungszeiten") + JS-`\b` ist ASCII-only und matched nicht vor Umlauten („ö") + Check-Reihenfolge ließ „mail adresse" als address_or_location laufen statt email + Korrektur-Form fiel bei Street-Extractor-Miss durch zu address_or_location statt zu Korrektur-Template + Pattern C zu breit (jedes „straße" + „?" = correction) | `<keyword>\w*` für Komposita; `(?:^|[^\wäöüß])` als Umlaut-Boundary; Reihenfolge umgestellt (spezifisch → generisch); bei isCorrectionForm IMMER return; Pattern C verlangt jetzt hasConcreteAddressMarker (Hausnr. ODER Bindestrich-Komposita) | `intent-contact.ts` + `scripts/smoke/bypass-baseline.ts` |
| 2026-05 | `appointment`-Intent ging durch LLM-Pfad obwohl Antwort deterministisch (Planity-Link) ist | Neuer Intent `appointment` mit Template-Response auf `planity_url` aus Config | `intent-contact.ts` |
| 2026-05 | **Cache-Stabilität-Bug: dynamische Inhalte (Geschäftszeit, Color-Code-Hint) waren im stable-Block** → jeder Call zerschoss bei jeder Anfrage den Cache-Hash → Ø-Kosten 18ct/Call statt 3ct (echte Daten aus `chatbot_usage_log`) | `pipeline.applyPreLlmContext` returnt `dynamicHint` jetzt SEPARAT; respond.ts trennt `systemPromptStable` (cached, 1h) vs. `systemPromptVariable` (uncached, am Ende). Geschäftszeit + Color-Code-Hint in den uncached-Block verschoben. Erwartung: -50-70% Cost pro Call sobald Cache greift, messbar in `cache_read_input_tokens` der nächsten Calls. | `pipeline.ts`, `respond.ts` |
| 2026-05 | **Farbberatung: Bot springt zu konkreten Produkt-URLs ohne Haarstruktur/Methode/Länge geklärt** → falsche Produkte (z.B. wellige Bondings für glattes Haar) | `categoryHardRule` für `color_advice`: PRIO-1 Klärungsfragen zuerst (struktur+methode+länge), erst dann `get_available_colors`. PRIO-2 mit max 3-5 fokussierten Farben. Beispiele richtig/falsch im Prompt. Sibling-Klasse: gleiche Logik gilt auch für method/length-Empfehlungen ohne geklärte Voraussetzungen | `respond.ts` |
| 2026-05 | **Audio/Video/Ephemeral-Bypass ignoriert vorigen Text-Kontext** → Kundin schreibt 3 lange Textblöcke, schickt dann Video → Bot feuert sofort static "Bin nur ein Bot, kann keine Videos hören"-Antwort, ohne die Textblöcke zu erwähnen → wirkt wie dummer Bot der nicht zuhört. Plus: läuft VOR Kill-Switch und VOR Debounce | Kontext-Check: Bypass nur feuern wenn in den letzten 30 Min KEINE echte Text-Message (Length > 5, nicht nur Attachment-Label) in der Session. Mit Text-Kontext → durchfallen → normale Pipeline → Kill-Switch blockt → Mitarbeiterin manuell. Sibling: gleicher Pattern für Audio + Ephemeral-Foto mitgefixt | `webhooks/meta/route.ts` |
| 2026-05 | **Mitarbeiter müssen zur IG-App wechseln um ältere Customer-Historie zu sehen** — DB hält nur die letzten ~100 msg pro Conversation aus dem Sync. Median nur 6,5 msg/Session in DB. Stammkundinnen-Kontext fehlt komplett. | Per-Session-Backfill: neuer Endpoint `/api/chatbot/sync-instagram-session` holt ~50 ältere msgs auf Knopfdruck. Pagination via gecachter `paging.next`-URL in `chat_sessions.ig_messages_next_url`. UI: dezenter Button oberhalb des Verlaufs. Mehrfach klickbar bis Conversation erschöpft. Sibling: WhatsApp-Backfill folgt (andere API, gleicher Pattern) | `api/chatbot/sync-instagram-session/route.ts`, `load-older-messages-button.tsx`, Migration 0081 |
| 2026-05 | **FAQ-Topic-Field als Titel missbraucht — 22 wichtige Pinned-FAQs kamen nicht im Bot-Prompt an** (Topic-Filter im Code matched String-equal, Emoji-Titel im DB-topic-Feld passten nicht oder ungenau zur Whitelist). User-Beobachtung: Bot verwechselt Genius Weft mit Invisible Wefts trotz vorhandener Anti-Verwechslungs-FAQ | Neue Spalte `chatbot_faq.pinned`. Pinned-FAQs werden IMMER geladen (2-Query-Pattern: pinned-query + topic-query, dedup über slug). 22 betroffene FAQs migriert: `topic` auf echte Kategorie umgestellt, `pinned=true` gesetzt, alter Titel im `notes`-Feld archiviert. CORE_TOPICS und TOPIC_BY_KEYWORD im Code aufgeräumt (keine Emoji-Titel mehr). Künftige Pinned-FAQs einfach `pinned=true` setzen, kein Title-im-Topic-Hack mehr | Migration 0082, `respond.ts` FAQ-Loader |
| 2026-05 | **Lager-Check findet 8/15 Reservierungen nicht — Matcher zu strikt + Gewicht-Token-Bug + Service-Items als Inventar behandelt + Slash-Tokenize zerlegt Farbcodes** | 4 Klassen strukturell behoben: (A) Stop-Word-Liste massiv erweitert um beschreibende Wörter (us, wellige, standard, balayage, melt, echthaar, ombré…). (B) Gewicht-/Längen-Token (150g, 65cm) raus aus Such-Tokens, separat gegen `unitWeight` bzw. Length-im-Produktname gematcht. (C) Service-Items (Farbring, Pflegeset, Beratung…) per Regex früh erkannt, neuer Status `service_item` mit lila UI-Bucket. (D) Slash + Bindestrich bleiben im Tokenize ("4/27T24" als ein Token statt "4" + "27t24"). Sibling: gleicher Matcher gilt auch für Bot-Tool `get_stock_eta` — TODO mitziehen | `chat-reservations.ts`, `stock-check-button.tsx` |
| 2026-05 | **Guardian alarmiert „long_wait_no_answer" bei reinen Instagram-Story-Mentions** (Customer markiert uns in Story, ist keine echte Anfrage — Guardian wertet aber jedes [Foto] als „braucht Antwort") | Pre-Haiku-Filter: wenn `attachments[].type` nur in `{story_mention, ig_post, ig_reel, share, reaction, story_reply}` UND content nur `[Foto]`/`[Video]`-Label → kein Alert. 7 bestehende false-positive-Alerts via SQL als `dismissed` markiert. Sibling-Klasse: alle Instagram-Interaktionen ohne Anliegen-Inhalt sollten bot-/guardian-unsichtbar bleiben | `guardian.ts` long_wait Scanner |
| 2026-05 | **Dashboard ↔ Instagram-App Sync war manueller Klick-only** — Dashboard-Action „gesehen" propagierte nicht zu IG, IG-App-Aktion „als ungelesen" propagierte nicht zum Dashboard | 3-Phasen-Lösung (Dashboard ist Master): (1) `markInstagramSeen()` via Meta API `sender_action: mark_seen` — wird bei `markSessionAsSeen` fire-and-forget aufgerufen. (2) Light-Sync-Cron `/api/chatbot/sync-instagram-light` alle 30 Min — pollt nur `unread_count`, kein Message-Fetch. (3) Divergenz-Badge `📱 IG ungelesen` pro Session-Card wenn IG-unread > 0 und Dashboard schon „gesehen". | `lib/messaging/meta.ts`, `chat-inbox.ts`, `vercel.json`, `inbox/page.tsx` |
| 2026-05 | **„MA markiert in IG-App als ungelesen" → Dashboard sah nur Badge, Session blieb im falschen Filter** | Variante B: Light-Sync setzt zusätzlich `last_seen_by_agent_at=null` wenn `ig_unread_count>0` UND letzte Dashboard-Aktion >10 Min alt (Grace-Period gegen Race-Conditions mit Phase 1 mark_seen). Session wandert automatisch zurück in „Zu tun"-Filter. Cron läuft alle 30 Min — max-Verzögerung bis Reaktivierung also 30 Min. | `sync-instagram-light/route.ts` |
| 2026-05 | **Lager-Matcher STOP-Liste war zu aggressiv — Method-Indikatoren wurden gestrippt** → „NORVEGIAN Standard Tapes" matchte fälschlich „NORVEGIAN Invisible Clip Extensions", „BITTER CACAO Standard Tape" matchte fälschlich „BITTER CACAO Mini Tape Extensions" | STOP enthält jetzt KEIN `tape`, `tapes`, `extension`, `extensions`, `standard` mehr (Method×Subtype-tragend). Verifiziert mit 7 Bug-Cases: alle Method-Mismatches → no-match, echte Matches → match. Sibling: gleiche Logik gilt für Bot-Tool `get_stock_eta` (separater TODO) | `chat-reservations.ts` |
| 2026-05 | **„4/27T24 / VIKING BLOND" Tape-Reservierungen wurden nicht gefunden** obwohl im Usbekisch-Sheet vorhanden. Grund: Sheet-Collection heißt nur `"Tapes Wellig 65cm"` (kein expliziter „Standard"-Prefix), Token `standard` aus Reservierung matched nichts | Subtype-Awareness: `classifySubtype()` erkennt explicit Mini/Genius/Classic/Invisible. Wenn keiner → `wantsDefault=true` → „standard" wird aus Tokens gestrippt UND haystack darf KEINEN anderen expliziten Subtype haben. Edge-Case: bei Clip-Extensions ist „Invisible" Marken-Bestandteil, kein Subtype → check übersprungen wenn search „clip" enthält. Verifiziert mit 8 Test-Cases | `chat-reservations.ts` |
| 2026-05 | **Cross-Line-Match: „Mocha Melt US Wellige Tape" matchte fälschlich „MOCHAMELT STANDARD RUSSISCHE TAPE"** — beide Farben existieren in BEIDEN Linien (russisch+usbekisch), Matcher hatte keine Linien-Awareness | `extractLineFromText()` erkennt „us wellige/wellig/usbekisch" → usbekisch, „russisch/glatt" → russisch. InventoryRows werden mit `_line`-Tag versehen (basierend auf Sheet-Tab). `fullMatch` blockt wenn `reservationLine !== row._line`. Wenn Reservierung KEINE Linie nennt → unspezifiziert, beide Linien erlaubt. Sibling-Klasse: gleicher Bug-Pattern in Bot-Tool get_stock_eta — TODO mitziehen | `chat-reservations.ts` |
| 2026-05 | **Bot rief get_stock_eta zweimal auf — einmal mit Farbe, einmal mit „wellig tape 65cm"** → zweiter Call matchte 30+ Wellig-65cm-Tapes (viele qty>0) → Tool returnte „in_stock" → Bot kombinierte beide Results zu „4/27T24 ist auf Lager + ETA 25.06", obwohl Sheet für 4/27T24 klar qty=0 sagt. Source-of-Truth (Sheet) wurde korrekt gelesen, aber durch den zweiten broad-search überfahren | **search_too_broad-Guard** in `get_stock_eta`. `BROAD_NOISE`-Set: alle Method-/Linien-/Längen-/Subtyp-/Material-Wörter plus reine Farb-Deskriptoren (braun/blond). Wenn ALLE cleaned Tokens in BROAD_NOISE oder numeric (60cm/225g) sind → kein Farb-Identifier vorhanden → status=`search_too_broad` zurück, Bot MUSS mit konkreter Farbe oder Farb-Code (4/27T24, 5P18A, 3T8A) erneut suchen. Branded Color-Modifier (smoky, macadamia, cherry, 3t, 5m) bleiben ABSICHTLICH ausserhalb BROAD_NOISE — sie sind Color-Identifier. Smoke-Test 20/20 (alle broad-Patterns erkannt, alle Farb-Suchen durchgelassen) | `tools/index.ts` getStockEta |
| 2026-05 | **Bot matchte „SMOKY TAUPE" auf Kundinnen-Suche nach „TAUPE"** — Substring-Match `hay.includes("taupe")` greift bei „SMOKY TAUPE STANDARD…". URL war intern konsistent (SMOKY URL zu SMOKY Name), Output-Sanitizer fand also nichts. User-Beobachtung: „dachte du hattest das schon gelöst" — bisheriger Output-Sanitizer fängt nur URL-vs-Name-Mismatch, nicht aber den Fall dass der Bot ein anderes Produkt als gefragt zurückgibt | **Compound-Color-Guard**: Modifier-Liste automatisch aus `product_colors` detektiert (Script `scripts/tmp/build-modifiers-v2.mjs`). 5 echte Modifier gefunden: `smoky`, `macadamia`, `cherry`, `3t`, `5m`. Regel: Wenn Haystack einen Modifier als ganzes Wort enthält (Word-Boundary-Regex) UND Search diesen Modifier NICHT enthält → Row ablehnen. Sibling: gleicher Guard in `get_stock_eta` UND `chat-reservations.ts` Lager-Scan eingebaut. Smoke-Test 17/17 grün (TAUPE/SMOKY, GLOW/MACADAMIA GLOW, RED/CHERRY RED, PEARL WHITE/3T PEARL WHITE, SILVER/5M SILVER + Edge-Cases). Bei neuen Compound-Farben in product_colors: Script erneut laufen, Liste in beiden Dateien ergänzen | `tools/index.ts` get_stock_eta, `chat-reservations.ts` |
| 2026-05 | **Globaler Kill-Switch zu grob — Bot antwortet auch bei Verfügbarkeits-/Preis-Standardfragen nicht mehr** (User-Beobachtung: „der bot antwortet immer noch nicht automatisch bei verfügbarkeitsanfragen"). Trade-off: 100% Kostenschutz vs. 0% Automatisierung | Granularer Kill-Switch (Migration 0083): neue Spalte `chatbot_settings.proactive_safe_categories TEXT[]` mit Default `[availability, general, pricing]`. `isProactiveGenerationEnabled(category)` returnt true wenn Master-Switch on ODER (Master off ∧ category ∈ Whitelist). `order_status` BEWUSST NICHT auf Whitelist: Bot hat kein Order-Lookup-Tool (Shopify-API nicht angebunden), Auto-Reply wäre nur statische „schau in deine Mail"-Phrase. Riskante Categories (color_advice/gewerbe/appointment/complaint/partnership/order_status) bleiben Mitarbeiter-Click only. classifySession wird jetzt SYNCHRON vor dem Kill-Switch-Check ausgeführt (Webhook + 2 setBotMode-Trigger), damit Whitelist-Lookup eine echte Category hat. Ohne Category bei aktivem Kill-Switch → blockiert (konservativ) | `settings.ts`, `webhooks/meta/route.ts`, `chat-inbox.ts`, Migration 0083 |
| 2026-05 | Token-Kosten explodieren (≥17ct/call) | 1h Cache-TTL + Persona-Trim + Refine-Limit 2 + FAQs statt Persona | `bedrock-client.ts`, DB `chatbot_persona`, FAQ-Topic-Filter |

**Konvention:** Bei jedem strukturellen Fix wird diese Tabelle ergänzt.
Wenn das vergessen wird und derselbe Bug nochmal kommt → SOFORT
nachtragen, nicht „später mal".

---

## 3. Anti-Patterns — die häufigsten Fehler

### 3.1 „Noch eine FAQ schreiben" als Erstlösung
**Wann erlaubt:** für echte Verhaltensregeln, die KEINE Daten betreffen
(z.B. „antworte fokussiert, eine Sache pro Message").

**Wann VERBOTEN:** wenn das Problem ein Fakt ist, den wir in der DB haben.
„Bot soll immer Tool X aufrufen" → Pre-LLM-Inject, nicht FAQ.

### 3.2 Varianten einfangen
„Auch diese Adress-Variante" / „auch diesen Farbcode" → IMMER strukturelle
Invariante suchen. Wenn man "noch einen Fall" hinzufügen will → STOP,
zurück zur Klasse.

### 3.3 Bot zwingen, Tool X aufzurufen
Funktioniert in 95% der Fälle, scheitert in den 5%, die wir nicht
wollen. Stattdessen: Tool-Output deterministisch injizieren.

### 3.4 Symptom-Fix ohne Klassen-Frage
Vor jedem Fix die Frage: *„Welche STRUKTUR erzeugt diese Klasse von Bugs?
Wie verhindere ich, dass diese ganze Klasse je wieder auftritt?"*

### 3.5 Pflaster auf Pflaster
Wenn dieselbe Stelle 3× gefixt wurde → die Architektur ist falsch.
Refactor statt 4. Fix.

---

## 4. EINE Pipeline für beide Routes — `pipeline.ts` (seit 2026-05)

**Endlich konsolidiert.** Beide Routes
(`/api/webhooks/meta/route.ts` + `respond.ts` für Instagram/WhatsApp,
und `/api/chat/route.ts` für Web-Chat/Dashboard-Test) rufen nur noch
zwei Funktionen aus `src/lib/chatbot/pipeline.ts`:

```ts
const pre  = await applyPreLlmContext(systemPrompt, customerText);
//   ↳ fügt Color-Code-Inject hinzu (später: Stock, Stylistinnen)
//   ↳ returned ctx mit Match-Daten für Validator unten

// ... Anthropic-Call ...

const out = applyPostLlmSanitizers(finalText, pre.ctx);
//   ↳ ruft enforceBusinessFacts + validateNegativeClaims
//   ↳ ruft applyAllOutputSanitizers (10 Sub-Sanitizer)
//   ↳ returned { text, changed } für Stream-Korrektur
```

**Konsequenz:** Wer einen neuen Sanitizer/Injector hinzufügen will,
ändert AUSSCHLIESSLICH `pipeline.ts`. Beide Pipelines erben automatisch.
Die ganze Klasse "vergessen in einer Pipeline einzubauen" ist
strukturell eliminiert.

**Bewusst NICHT in pipeline.ts** (bleibt in respond.ts):
- `sanitizeStockLeaks` — braucht Tool-Result-Context
- ETA-Linien-Validator — braucht Tool-Result-Context
- Ephemeral-Halluzinations-Sanitizer — braucht message-history
- Contact-Intent-BYPASS (Template statt LLM-Call) — ersetzt die ganze
  Response, läuft VOR jeglicher Pipeline. Bleibt pro Route.

Diese sind respond-spezifisch und haben keinen Sinn in der Web-Chat-
Route (die hat keine vergleichbaren Tool-Calls).

**Bonus-Erkenntnis aus dem Refactor:** `respond.ts` (Live-Webhook)
hatte historisch `applyAllOutputSanitizers` GAR NICHT aufgerufen —
nur `refine.ts` (Mitarbeiter klickt „Neu generieren") tat das.
Live-Bot-Antworten an Customers gingen also ohne stripMarkdown /
stripRedundantFollowupQuestion / scrubWeekendTrap / etc. raus.
Mit der zentralen Pipeline jetzt strukturell behoben.

---

## 5. Pickup-Checkliste für eine neue Session

1. Diese Datei lesen.
2. `~/.claude/projects/-Users-macbook-hairvenly-inventory/memory/MEMORY.md` lesen.
3. Bei Bug-Report: ZUERST in §2 schauen ob die Klasse schon gelöst ist.
4. Bei „wie strukturell lösen?": in §1 nach passendem Prinzip suchen.
5. Bei Frust-Aussagen vom User („das hatten wir doch schon", „immer dasselbe"):
   - SOFORT diese Datei aktualisieren.
   - Eintrag in §2 nachtragen.
   - Im selben Commit wie der Fix.

---

## 6. Wenn etwas nicht in dieser Datei steht

…und es ist eine wiederkehrende Diskussion / ein wiederkehrender Bug:
**das ist ein Bug in dieser Datei selbst**. Ergänzen, sofort.
