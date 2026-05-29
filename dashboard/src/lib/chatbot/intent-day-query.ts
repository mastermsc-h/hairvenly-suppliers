/**
 * Day-Query-Detector: erkennt wenn die Kundin nach Öffnungs-Status für einen
 * KONKRETEN Tag fragt ("morgen", "übermorgen", "Samstag", "am Wochenende",
 * "heute Abend") und löst diese Tags deterministisch zu open/closed auf.
 *
 * Warum Pre-LLM-Inject statt Prompt-Regel?
 *   Der Bot hat den Persona-Hinweis "Mo-Fr 10-18". Wenn die Kundin "morgen"
 *   schreibt rechnet Sonnet NICHT immer selbst aus welcher Wochentag morgen
 *   ist — er antwortet ungeprüft "ja, morgen 10-18 offen". Bug am
 *   2026-05-29 (Freitag) in Production beobachtet: Bot bestätigt "morgen
 *   10-18 offen" obwohl morgen Samstag = zu.
 *
 * Pattern: gleicher Defense-in-Depth wie color-codes / stock-eta:
 *   1. Pre-LLM: deterministisch berechnen + Hint injizieren
 *   2. Post-LLM (separat in output-sanitizers): Bot-Claims gegen die
 *      Wahrheit validieren, force-Draft bei Lüge
 *
 * Sibling-Sweep:
 *   - "morgen"           → +1 Tag
 *   - "übermorgen"       → +2 Tage
 *   - "heute"            → 0
 *   - "heute Abend"      → 0 + Hint "geöffnet bis 18 Uhr"
 *   - weekday-Name       → nächster Tag mit dem Namen (Montag…Sonntag)
 *   - "Wochenende"       → Sa+So (zu)
 *   - "diese Woche"      → Restwerktage diese Woche
 *   - "nächste Woche"    → nächste Mo-Fr
 *   (Konkrete Daten "12. Juni" / "5.6." → Phase 2, komplexer.)
 */
import { getBusinessHoursContext } from "./business-hours";

const WEEKDAY_NAMES: { name: string; idx: number }[] = [
  { name: "sonntag",    idx: 0 },
  { name: "montag",     idx: 1 },
  { name: "dienstag",   idx: 2 },
  { name: "mittwoch",   idx: 3 },
  { name: "donnerstag", idx: 4 },
  { name: "freitag",    idx: 5 },
  { name: "samstag",    idx: 6 },
];

// Bremen-Feiertage 2026 (mirror der Liste aus business-hours.ts —
// SOLLTE in Phase 2 in eine gemeinsame Konstante extrahiert werden).
const HOLIDAYS_2026 = new Set([
  "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-01",
  "2026-05-14", "2026-05-25", "2026-10-03", "2026-10-31",
  "2026-12-25", "2026-12-26",
]);

type DayStatus = {
  iso: string;            // 2026-05-30
  weekday: string;        // "Samstag"
  weekdayShort: string;   // "Sa"
  dateLabel: string;      // "30.05."
  isOpen: boolean;
  reason: string;         // "Wochenende" / "Feiertag" / "Werktag"
  hours: string | null;   // "10:00-18:00" oder null wenn zu
};

function computeDayStatus(date: Date): DayStatus {
  const fmt = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
  const weekday = parts.weekday || "";
  const iso = `${parts.year}-${parts.month}-${parts.day}`;
  const dateLabel = `${parts.day}.${parts.month}.`;
  const isWeekend = weekday === "Samstag" || weekday === "Sonntag";
  const isHoliday = HOLIDAYS_2026.has(iso);
  const isOpen = !isWeekend && !isHoliday;
  let reason = "Werktag";
  if (isHoliday) reason = "Feiertag";
  else if (isWeekend) reason = "Wochenende";
  const shortMap: Record<string, string> = {
    "Montag": "Mo", "Dienstag": "Di", "Mittwoch": "Mi",
    "Donnerstag": "Do", "Freitag": "Fr", "Samstag": "Sa", "Sonntag": "So",
  };
  return {
    iso,
    weekday,
    weekdayShort: shortMap[weekday] || weekday.slice(0, 2),
    dateLabel,
    isOpen,
    reason,
    hours: isOpen ? "10:00-18:00" : null,
  };
}

function addDays(base: Date, n: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

function dayOffsetForWeekdayMention(todayIdx: number, targetIdx: number): number {
  // Welcher nächste Tag mit diesem Wochentag-Index?
  // Wenn heute = Freitag (5), Kundin sagt "Samstag" (6) → +1
  // Wenn heute = Freitag (5), Kundin sagt "Montag" (1)  → +3
  // Wenn heute = Freitag (5), Kundin sagt "Freitag" (5) → 7 (= nächste Woche,
  //   weil "am Freitag" wenn man heute schon ist = nächste Woche meinen).
  let diff = targetIdx - todayIdx;
  if (diff <= 0) diff += 7;
  return diff;
}

export type DayQueryMatch = {
  trigger: string;       // "morgen" / "samstag" / "übermorgen"
  offset: number;        // Tage ab heute
  status: DayStatus;
};

export function detectDayQueries(customerText: string): DayQueryMatch[] {
  if (!customerText) return [];
  const t = customerText.toLowerCase();
  const matches: DayQueryMatch[] = [];
  const seenOffsets = new Set<number>();

  const todayCtx = getBusinessHoursContext();
  // Get today's date in Berlin TZ
  const now = new Date();
  const todayWeekdayIdx = WEEKDAY_NAMES.find(w => w.name === todayCtx.todayWeekday.toLowerCase())?.idx ?? -1;

  function pushOffset(trigger: string, offset: number) {
    if (seenOffsets.has(offset)) return;
    seenOffsets.add(offset);
    matches.push({ trigger, offset, status: computeDayStatus(addDays(now, offset)) });
  }

  // 1. relative-day Tokens
  // 🚨 JS-Regex-Falle: \b ist ASCII-only und matched NICHT vor/nach Umlauten
  // ("übermorgen", "über" → \b vor "ü" matched nicht). Wir nutzen daher
  // Custom-Boundary [^\wäöüß] (wie in intent-contact.ts).
  const UB = "(?:^|[^\\wäöüß])"; // unicode-safe linke Boundary
  const UE = "(?=[^\\wäöüß]|$)"; // unicode-safe rechte Boundary
  if (new RegExp(UB + "übermorgen" + UE, "i").test(t)) {
    pushOffset("übermorgen", 2);
  }
  // "morgen" — aber nur wenn nicht Teil von "übermorgen"
  if (new RegExp(UB + "morgen" + UE, "i").test(t) && !new RegExp(UB + "übermorgen" + UE, "i").test(t)) {
    pushOffset("morgen", 1);
  }
  if (new RegExp(UB + "heute" + UE, "i").test(t)) {
    pushOffset("heute", 0);
  }

  // 2. Wochentag-Namen ("am Samstag", "Sonntag offen?", "habt ihr Montag auf?")
  if (todayWeekdayIdx >= 0) {
    for (const w of WEEKDAY_NAMES) {
      // Regex: Wort-Boundary + Wochentag, vermeidet "Sonntags" etc als Plural-Adverb
      const re = new RegExp(`(^|[^a-zäöü])${w.name}(s|en)?\\b`, "i");
      if (re.test(t)) {
        const offset = dayOffsetForWeekdayMention(todayWeekdayIdx, w.idx);
        // Nur < 14 Tage (sonst eher allgemeine Anfrage statt konkret)
        if (offset > 0 && offset < 14) {
          pushOffset(w.name, offset);
        }
      }
    }
  }

  // 3. "am Wochenende" / "übers Wochenende"
  if (/\b(wochenende|am\s+wochenend|übers\s+wochenend)\b/i.test(t)) {
    if (todayWeekdayIdx >= 0) {
      // nächster Samstag
      const offsetSa = dayOffsetForWeekdayMention(todayWeekdayIdx, 6);
      const offsetSu = offsetSa + 1;
      pushOffset("samstag (wochenende)", offsetSa);
      if (!seenOffsets.has(offsetSu)) {
        pushOffset("sonntag (wochenende)", offsetSu);
      }
    }
  }

  return matches;
}

/**
 * Baut den Pre-LLM-Hint für detektierte Day-Queries.
 *
 * Beispiel-Output:
 *   🚨 ÖFFNUNGSZEIT-CHECK (Pre-LLM, deterministisch):
 *   - "morgen" → Samstag 30.05. = WIR HABEN ZU (Wochenende)
 *   - "übermorgen" → Sonntag 31.05. = WIR HABEN ZU (Wochenende)
 *   Bestätige NIEMALS Öffnung an diesen Tagen. Verweise auf den nächsten Werktag.
 */
export function buildDayQueryHint(matches: DayQueryMatch[]): string {
  if (matches.length === 0) return "";
  const lines: string[] = [];
  let anyClosed = false;
  for (const m of matches) {
    const s = m.status;
    if (s.isOpen) {
      lines.push(`  - "${m.trigger}" → ${s.weekday} ${s.dateLabel} = wir haben offen ${s.hours}`);
    } else {
      anyClosed = true;
      lines.push(`  - "${m.trigger}" → ${s.weekday} ${s.dateLabel} = WIR HABEN ZU (${s.reason})`);
    }
  }
  let out = `\n\n## 🚨 ÖFFNUNGSZEIT-CHECK (deterministisch berechnet)\nDie Kundin fragt nach einem konkreten Tag. Hier die TATSÄCHLICHEN Status (Mo-Fr 10-18, ohne Bremer Feiertage):\n${lines.join("\n")}\n`;
  if (anyClosed) {
    out += `\nBestätige NIEMALS Öffnung an Tagen die hier als "ZU" markiert sind. Falls die Kundin von einem falschen Annahmen ausgeht ("habe gehört bis 15 Uhr"), korrigiere freundlich und nenne den nächsten OFFENEN Tag.\n`;
  }
  return out;
}
