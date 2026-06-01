# Anti-Halluzinations-Architektur — die dauerhafte Lösung

> **Status:** Design beschlossen 2026-06-01 (Betreiber-Entscheidung „volle Lösung").
> **Problem, das das hier beendet:** Die Patch-Spirale. Jeder einzelne
> erfundene Fakt („Preis ist gleich", „jeden Moment", „morgen offen") wurde
> bisher mit einem eigenen Regex-Guard reaktiv abgefangen. Das ist gegen eine
> unendliche Menge an Formulierungen nicht zu gewinnen.

---

## 1. Die Grundsatz-Diagnose (warum Patches nie reichen)

Ein LLM ist eine **Sprach**-Maschine, keine **Wahrheits**-Maschine. Es füllt
jede Wissenslücke mit dem, was *plausibel klingt*. „Beide Linien gleich teuer"
klingt plausibel → also sagt es das. Es gibt **keine endliche Liste** schlechter
Sätze, die man wegfiltern kann.

Die bisherige Architektur war strukturell falsch:

> ❌ **Alt:** Bot darf alle Fakten frei formulieren → wir versuchen hinterher,
> die falschen mit Mustern zu fangen. (Reaktiv, musterbasiert, unendlicher
> Wettlauf.)

Die neue Architektur dreht das um:

> ✅ **Neu:** Das *System* liefert die geprüften Fakten. Das LLM darf sie nur
> noch sprachlich verpacken — nicht erfinden. Was sich nicht aus abgerufenen
> Daten belegen lässt, geht nicht raus.

**Kernprinzip:** *Fakten und Stimme trennen.* Das LLM ist für **Ton** zuständig,
die **Tools/DB** für **Wahrheit**.

---

## 2. Zwei Schichten — ein Mechanismus pro Schicht, unendliche Abdeckung

### Schicht 1 — Prävention: Tool-Zwang bei Fakten-Intents

Für die abgrenzbaren Fakten-Kategorien (Preis, Verfügbarkeit/Lager, Längen/
Methoden-Matrix) wird der Bot über die Anthropic-API **gezwungen**, das passende
Tool aufzurufen, BEVOR er antworten darf (`tool_choice: { type: "tool" }` bzw.
`{ type: "any" }`).

- Erkennt ein deterministischer Intent-Classifier (kein LLM-Raten) eine
  Preisfrage → der erste API-Call erlaubt NUR `get_price`. Der Bot *kann*
  physisch keine Preis-Antwort formulieren, ohne vorher die echten Zahlen
  geholt zu haben.
- Das ist der Unterschied zwischen einem Schild „bitte nicht erfinden" (Prompt-
  Regel, wird ignoriert) und einer **Wand** (API-Constraint, kann nicht
  umgangen werden).

**Deckt unendlich viele Formulierungen ab**, weil es nicht an Output-Wörtern
hängt, sondern am *Vorhandensein der Daten*.

### Schicht 2 — Generischer Faktencheck (ersetzt N Einzel-Guards)

EIN zusätzlicher, billiger Verifier-Pass (Haiku) bekommt:
- die fertige Bot-Antwort,
- die in diesem Turn tatsächlich abgerufenen Tool-Ergebnisse (= die „erlaubte
  Wahrheit"),
- die relevanten Stammdaten-Fakten.

und beantwortet **eine** Frage:

> „Liste JEDE Tatsachenbehauptung in dieser Antwort, die sich NICHT aus den
>  bereitgestellten Daten belegen lässt."

- **Semantisch, nicht musterbasiert** → fängt „gleich teuer", „etwas
  günstiger", „kostet dasselbe" und jede nie-vorhergesehene Formulierung mit
  demselben Mechanismus.
- Findet der Verifier ≥1 unbelegte Faktenbehauptung → `needsManualReview`
  → Entwurf statt Auto-Send (bestehender Force-Draft-Flow).
- Bei reiner Beratung/Smalltalk (keine Faktenbehauptung) → kein Eingriff.

**Das ist der eigentliche Paradigmenwechsel:** Wir hören auf, *schlechte
Outputs aufzuzählen*, und prüfen *alle Outputs gegen die Wahrheit*.

---

## 3. Messung — damit „wird es besser?" beweisbar wird

Ohne Messung bleibt es Bauchgefühl von Screenshot zu Screenshot. Deshalb:

- **Halluzinations-Metrik** in `chatbot_usage_log` (oder neue Tabelle):
  pro Faktenantwort festhalten, ob ein Tool-Beleg vorlag + ob der Verifier
  etwas Unbelegtes fand.
- Wöchentliche Kennzahl: **% Faktenantworten ohne Beleg** (Ziel: → 0).
- **Shadow-Mode zuerst:** Schicht 2 läuft erst NUR als Logger (markiert, sendet
  aber normal), bis die Baseline + die False-Positive-Rate bekannt sind. Erst
  dann scharf schalten (Force-Draft). → Zero-Regression-Garantie.

---

## 4. Migrationspfad (diszipliniert, hinter Flags)

1. **Baseline messen** (Schicht-2-Logik im Shadow-Mode, nur Logging) — wie oft
   halluziniert der Bot HEUTE? → ehrliche Ausgangszahl.
2. **Verifier scharf** (Force-Draft) hinter Flag `use_fact_verifier`, sobald
   False-Positive-Rate akzeptabel.
3. **Tool-Zwang** für Preis-Intent zuerst (engster, klarster Fall), dann
   Verfügbarkeit, dann Längen. Jeweils hinter Flag, einzeln messbar.
4. **Alte Einzel-Guards** (detect-price-hallucination etc.) bleiben als
   Redundanz, bis die Metrik zeigt dass Schicht 1+2 sie überflüssig machen —
   dann erst entfernen. Nie blind abbauen.

---

## 5. Was das löst — und was nicht (ehrliche Grenzen)

✅ **Strukturell gelöst:** erfundene Preise, Verfügbarkeiten, Längen,
Produktdaten, Haltbarkeiten — die ganze Klasse „Bot behauptet einen prüfbaren
Fakt, der falsch/unbelegt ist". Nicht mehr per Pflaster, sondern per Architektur.

⚠️ **Bleibt menschliches Urteil:** subjektive Beratung („welche Farbe passt zu
DIR") — aber die übergibt der Bot ohnehin an die Stylistin. Der Verifier prüft
*Fakten*, nicht *Geschmack*.

❌ **Kein Freifahrtschein:** Schicht 2 ist selbst ein LLM und nicht perfekt.
Deshalb Messung + Shadow-Mode + die deterministische Schicht 1 als Hauptschutz.
Der Verifier ist das Netz, der Tool-Zwang ist die Wand.

---

## 6. Leitsatz für alle künftigen Chatbot-Arbeiten

> **Wenn der Bot einen prüfbaren Fakt nennt, muss eine Datenquelle dahinterstehen
> — sonst geht er nicht raus. Wir filtern keine Lügen mehr, wir lassen nur
> belegte Wahrheit durch.**

Jeder neue „der Bot hat X erfunden"-Report ist ab jetzt KEIN neuer Patch,
sondern die Frage: *Hat Schicht 1 das Tool erzwungen? Hat Schicht 2 es gefangen?
Warum nicht?* — und der Fix passiert an EINEM dieser zwei Mechanismen, nie als
neuer Spezial-Regex.
