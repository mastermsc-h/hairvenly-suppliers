/**
 * ETA-AUSWAHL für alle Bot-Pfade (get_stock_eta, get_available_colors,
 * Pre-LLM-Inject). Eine Stelle, eine Regel.
 *
 * ROOT CAUSE (Bug 16.10.2026, Sarah / Latte Balayage + Butter Cream Clip 225g):
 * Das Sheet listet pro Produkt mehrere Bestellungen, einige davon mit
 * ÜBERFÄLLIGEM Liefertermin ("ETA überfällig: 20.08.2026"). Der Bot nahm
 * blind das FRÜHESTE Datum → ein Datum in der Vergangenheit ("kommt um den
 * 20.08."), obwohl eine andere Bestellung am 21.10. ankommt. Die Kundin
 * fragte "nächstes Jahr?", der Bot bestätigte das und erfand "2027".
 *
 * INVARIANTE: Der Bot bekommt NIE ein vergangenes Datum als Ankunftstermin.
 *   - Es gibt zukünftige Termine → der früheste ZUKÜNFTIGE gewinnt.
 *   - Alle Termine liegen in der Vergangenheit → overdue=true, KEIN Datum
 *     (Lieferung verzögert, neuer Termin offen).
 *   - Gar kein Datum → Rohtext (z.B. "bald"), overdue=false.
 */

export interface EtaSource {
  ankunft?: string;
  etaConfirmed?: boolean;
}

export interface PickedEta {
  /** Anzeige-Datum "DD.MM.YYYY" (null bei overdue) oder Rohtext ohne Datum */
  text: string | null;
  /** ISO "YYYY-MM-DD" des gewählten Termins (bei overdue: jüngster überfälliger) */
  iso: string | null;
  /** true = Datum stammt aus der gepflegten Bestellung (DB) */
  confirmed: boolean;
  /** true = alle bekannten Termine liegen in der Vergangenheit */
  overdue: boolean;
}

/** Heutiges Datum in Europe/Berlin als "YYYY-MM-DD". */
export function berlinTodayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(now);
}

/** "ca. Ankunft: 20.08.2026" / "ETA überfällig: 6.10.26" → { iso, text } */
export function parseEtaDate(s: string | undefined | null): { iso: string; text: string } | null {
  const m = (s || "").match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/);
  if (!m) return null;
  const d = m[1].padStart(2, "0");
  const mo = m[2].padStart(2, "0");
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  return { iso: `${y}-${mo}-${d}`, text: `${d}.${mo}.${y}` };
}

export function pickEta(perOrder: EtaSource[] | undefined | null, todayIso: string): PickedEta {
  const list = perOrder || [];
  const dated: Array<{ iso: string; text: string; confirmed: boolean }> = [];
  let undatedText: string | null = null;
  for (const o of list) {
    const p = parseEtaDate(o.ankunft);
    if (p) dated.push({ ...p, confirmed: o.etaConfirmed === true });
    else if (!undatedText && o.ankunft) undatedText = o.ankunft;
  }
  const future = dated.filter((x) => x.iso >= todayIso).sort((a, b) => a.iso.localeCompare(b.iso));
  if (future.length > 0) {
    const f = future[0];
    return { text: f.text, iso: f.iso, confirmed: f.confirmed, overdue: false };
  }
  if (dated.length > 0) {
    const latestPast = [...dated].sort((a, b) => b.iso.localeCompare(a.iso))[0];
    return { text: null, iso: latestPast.iso, confirmed: latestPast.confirmed, overdue: true };
  }
  return { text: undatedText, iso: null, confirmed: false, overdue: false };
}
