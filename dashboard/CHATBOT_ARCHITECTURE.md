# Hairvenly-Chatbot — Architektur, Prinzipien, gelöste Bug-Klassen

> ⚠️ **IMMER LESEN bei jeder Änderung am Chatbot.** Diese Datei ist das
> Gedächtnis des Projekts — sie verhindert, dass dieselben Bug-Klassen
> immer wieder neu "entdeckt" und neu "vorgeschlagen" werden.

---

## 🚨 Top-Regel: Löse wie ein echter Informatiker

Bei JEDEM Bug, BEVOR irgendwelcher Code angefasst wird:

1. **Bug-Klasse identifizieren** — nicht den einzelnen Fall.
   „Adresse halluziniert" ist kein Bug — die Klasse ist „Bot erfindet Fakten,
   die wir in der DB haben". Auch „5P18A nicht erkannt" gehört in dieselbe Klasse.

2. **In §3 (gelöste Bug-Klassen) nachschauen.** Wenn die Klasse schon
   gelöst ist → existierendes Pattern anwenden, NICHT neu erfinden.

3. **Strukturelle Invariante suchen.** Eine Regel, die alle Varianten der
   Klasse strukturell abdeckt — NIE Varianten enumerieren.

4. **Erst dann implementieren.** Keine Pflaster, keine zusätzliche FAQ als
   Erstlösung, keine "noch eine Sanitizer-Regel".

**Anti-Muster (NIE machen):**
- ❌ „Wir fangen auch diese Variante mit ab"
- ❌ „Ich schreibe eine FAQ, die dem Bot sagt er soll Tool X aufrufen"
- ❌ „Defensive Doppel-Absicherung an Stelle Y"
- ❌ „Den Edge-Case behandeln wir später"

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

## 4. Web-Chat vs. Webhook — getrennte Pipelines

**Wichtige Schuld**, noch nicht konsolidiert:
- `/api/chat/route.ts` — Web-Chat, eigener Anthropic-Stream
- `/api/webhooks/meta/route.ts` + `respond.ts` — Instagram/WhatsApp

Jeder neue Bot-Schutz muss in **BEIDEN** angewendet werden, sonst
greift er nur für eine Pipeline. Existierende Sanitizer/Bypässe sind in
beiden, neue müssen das auch sein.

**TODO**: Pipelines konsolidieren (Task #137).

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
