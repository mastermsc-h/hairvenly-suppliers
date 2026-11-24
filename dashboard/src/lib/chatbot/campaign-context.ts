/**
 * Aktionen/Rabatte für den Bot — Pre-LLM-Inject + Post-Guard (importfrei,
 * vom Smoke-Test direkt transpiliert).
 *
 * BUG 24.11.2026: Kundin fragt „wann gibt es den Black Week Rabatt?" → Bot:
 * „haben wir bereits auf Instagram angekündigt … @hairvenly". Beides erfunden:
 * Aktionen standen nirgends, das Profil heißt @hairvenly.de.
 *
 * Bug-Klasse: „Bot erfindet Fakten, die wir pflegen könnten" (wie Adresse,
 * Preise, ETA). Lösung nach Architektur §1.1: die gepflegten Aktionen
 * (chatbot_campaigns.public_info, Statistik-Seite) werden datumsabhängig in
 * den variablen Prompt-Block injiziert; der Post-Guard schickt Antworten mit
 * unbelegten Prozenten/Codes/„bereits angekündigt" in den Entwurf.
 */

export interface CampaignLite {
  name: string;
  starts_on: string;          // YYYY-MM-DD
  ends_on: string | null;
  public_info: string | null;
}

export const UPCOMING_DAYS = 30;
export const ENDED_DAYS = 14;

const dayMs = 86_400_000;
const toDay = (iso: string) => Date.parse(iso.slice(0, 10) + "T00:00:00Z");
const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const deDate = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split("-"); return `${d}.${m}.${y}`; };
/** Mit Wochentag — Bug 24.11.: Bot schrieb „ab Mittwoch" für Freitag, 27.11. (Wochentag selbst errechnet). */
const de = (iso: string) => `${WEEKDAYS[new Date(toDay(iso)).getUTCDay()]}, ${deDate(iso)}`;

export type CampaignState = "running" | "upcoming" | "ended" | "hidden";

export function campaignState(c: CampaignLite, todayIso: string): CampaignState {
  if (!c.public_info?.trim()) return "hidden";
  const t = toDay(todayIso), s = toDay(c.starts_on), e = toDay(c.ends_on ?? c.starts_on);
  if (t >= s && t <= e) return "running";
  if (s > t && s - t <= UPCOMING_DAYS * dayMs) return "upcoming";
  if (e < t && t - e <= ENDED_DAYS * dayMs) return "ended";
  return "hidden";
}

/** Prompt-Block (variabel, ändert sich mit dem Datum → NICHT in den Cache-Block). */
export function buildCampaignBlock(campaigns: CampaignLite[], todayIso: string, instagramHandle: string): string {
  const lines: string[] = [];
  const order: Record<CampaignState, number> = { running: 0, upcoming: 1, ended: 2, hidden: 3 };
  const visible = campaigns
    .map((c) => ({ c, st: campaignState(c, todayIso) }))
    .filter((x) => x.st !== "hidden")
    .sort((a, b) => order[a.st] - order[b.st] || a.c.starts_on.localeCompare(b.c.starts_on));
  for (const { c, st } of visible) {
    const range = c.ends_on && c.ends_on !== c.starts_on ? `${de(c.starts_on)} bis ${de(c.ends_on)}` : de(c.starts_on);
    if (st === "running") lines.push(`- **${c.name}** — LÄUFT JETZT (${range}): ${c.public_info!.trim()}`);
    else if (st === "upcoming") lines.push(`- **${c.name}** — KOMMT, startet am ${de(c.starts_on)} (${range}): ${c.public_info!.trim()} — vorher gilt der Rabatt noch NICHT.`);
    else lines.push(`- **${c.name}** — BEENDET am ${de(c.ends_on ?? c.starts_on)}, gilt nicht mehr.`);
  }
  let block = `\n## 🏷 AKTIONEN & RABATTE (heute ${de(todayIso)})\n`;
  // Wochentage stehen dabei — nie selbst ausrechnen.
  block += lines.length
    ? lines.join("\n") + "\n"
    : "- Aktuell ist KEINE zeitlich begrenzte Aktion eingetragen.\n";
  block += `- Zu Aktionen NUR diese Angaben nennen (Zeitraum mit genau diesen Wochentagen, Prozente, Produkte genau so). NIE Rabatthöhen, Codes, Zeiträume oder „wurde bereits angekündigt/gepostet" erfinden.\n`;
  block += `- Details, die hier nicht stehen (welche Farben, Rabattcode, genaue Prozente je Produkt) → ehrlich sagen, dass alle Infos auf Instagram ${instagramHandle} geteilt werden.\n`;
  return block;
}

// ── Post-Guard ─────────────────────────────────────────────────────────────

const PROMO_CTX = /(rabatt|aktion|sale|black|cyber|week|friday|reduziert|spar|angebot|prozent|code|gutschein|off\b|nachlass)/i;

export interface PromoCheck { suspicious: boolean; reason?: string; snippet?: string }

/**
 * Antwort enthält Aktions-Angaben, die in keiner Quelle (Prompt inkl.
 * Aktions-Block/FAQ, Tool-Ergebnisse) stehen → verdächtig.
 */
export function detectPromoHallucination(text: string, evidence: string[]): PromoCheck {
  const ev = evidence.join("\n");
  const evNorm = ev.replace(/\s+/g, " ");

  // 1) „bereits angekündigt / schon gepostet" — Behauptung über unsere Kanäle, nie belegbar
  const announced = text.match(/\b(bereits|schon)\s+(\S+\s+){0,8}?(angekündigt|bekannt\s*gegeben|bekanntgegeben|gepostet|veröffentlicht)\b/i);
  if (announced) return { suspicious: true, reason: "behauptet, eine Aktion sei bereits angekündigt", snippet: announced[0] };

  // 2) Prozentangaben im Aktions-Kontext müssen belegt sein
  for (const m of text.matchAll(/(\d{1,2})\s?(%|prozent)/gi)) {
    const i = m.index ?? 0;
    const ctx = text.slice(Math.max(0, i - 100), i + 100);
    if (!PROMO_CTX.test(ctx)) continue;
    const re = new RegExp(`(^|[^0-9])${m[1]}\\s?(%|prozent)`, "i");
    if (!re.test(evNorm)) return { suspicious: true, reason: `${m[1]} % Rabatt ist nirgends belegt`, snippet: ctx.trim().slice(0, 120) };
  }

  // 3) Rabattcodes (HERO20, BLACK30 …) müssen belegt sein
  for (const m of text.matchAll(/\b([A-Z][A-Z0-9]{2,}\d{1,3})\b/g)) {
    const i = m.index ?? 0;
    const ctx = text.slice(Math.max(0, i - 60), i + 40);
    if (!/(code|gutschein|rabatt)/i.test(ctx)) continue;
    if (!ev.includes(m[1])) return { suspicious: true, reason: `Rabattcode ${m[1]} ist nirgends belegt`, snippet: ctx.trim() };
  }
  return { suspicious: false };
}
