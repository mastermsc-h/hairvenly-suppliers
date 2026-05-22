/**
 * Geschäftszeit-Kontext für den Chatbot.
 *
 * Öffnungszeit: Mo-Fr 10:00-18:00 Uhr (Europe/Berlin),
 * ohne gesetzliche Feiertage in Bremen.
 *
 * Drei Status-Stufen:
 *   open_wide          — geöffnet, mehr als 60 Min bis Feierabend
 *   open_closing_soon  — geöffnet, weniger als 60 Min bis Feierabend
 *   closed             — Wochenende, Feiertag, vor 10, nach 18
 *
 * Der Bot bekommt diese Info im System-Prompt UND nutzt sie für direkte
 * Antworten (z.B. Audio-Bypass) — damit Wartezeit-Versprechen realistisch
 * formuliert werden ("noch heute" vs. "Montag früh" etc.).
 */
export function getBusinessHoursContext(): {
  status: "open_wide" | "open_closing_soon" | "closed";
  isOpen: boolean;
  nowLabel: string;
  reason: string;
  nextOpenLabel: string;
  realisticHandoverLabel: string;
  nextWorkdayLabel: string;
  todayWeekday: string;
} {
  const now = new Date();
  const berlinFmt = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(berlinFmt.formatToParts(now).map(p => [p.type, p.value]));
  const weekday = parts.weekday || "";
  const hour = Number(parts.hour || "0");
  const minute = Number(parts.minute || "0");
  const isoDate = `${parts.year}-${parts.month}-${parts.day}`;

  // Bremen-Feiertage 2026 (bundesweite + Reformationstag seit 2018)
  const bremenHolidays2026 = new Set([
    "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-01",
    "2026-05-14", "2026-05-25", "2026-10-03", "2026-10-31",
    "2026-12-25", "2026-12-26",
  ]);
  const isHoliday = bremenHolidays2026.has(isoDate);

  const weekendDays = new Set(["Samstag", "Sonntag"]);
  const isWeekend = weekendDays.has(weekday);
  const inWorkHours = hour >= 10 && hour < 18;
  const isOpenAtAll = !isWeekend && !isHoliday && inWorkHours;

  const minutesUntilClose = (18 - hour) * 60 - minute;
  const isClosingSoon = isOpenAtAll && minutesUntilClose <= 60 && minutesUntilClose > 0;

  let status: "open_wide" | "open_closing_soon" | "closed" = "closed";
  if (isOpenAtAll && !isClosingSoon) status = "open_wide";
  else if (isClosingSoon) status = "open_closing_soon";

  const isOpen = isOpenAtAll;
  const nowLabel = `${weekday} ${parts.hour}:${parts.minute}`;
  let reason = "geöffnet";
  if (isHoliday) reason = "Feiertag";
  else if (isWeekend) reason = "Wochenende";
  else if (hour < 10) reason = "vor Öffnung";
  else if (hour >= 18) reason = "Feierabend";
  else if (isClosingSoon) reason = `kurz vor Feierabend (noch ${minutesUntilClose} Min bis 18:00)`;

  let nextOpenLabel = "Mo-Fr 10:00-18:00 Uhr";
  if (weekday === "Freitag" && (hour >= 18 || isClosingSoon)) {
    nextOpenLabel = "Montag ab 10:00 Uhr";
  } else if (weekday === "Samstag") {
    nextOpenLabel = "Montag ab 10:00 Uhr";
  } else if (weekday === "Sonntag") {
    nextOpenLabel = "morgen früh ab 10:00 Uhr";
  } else if (!isOpenAtAll && hour < 10) {
    nextOpenLabel = "heute ab 10:00 Uhr";
  } else if (!isOpenAtAll && hour >= 18) {
    nextOpenLabel = "morgen früh ab 10:00 Uhr";
  } else if (isHoliday) {
    nextOpenLabel = "am nächsten Werktag ab 10:00 Uhr";
  } else if (isClosingSoon && weekday !== "Freitag") {
    nextOpenLabel = "morgen früh ab 10:00 Uhr";
  }

  let realisticHandoverLabel: string;
  if (status === "open_wide") {
    realisticHandoverLabel = "gleich (Mitarbeiterinnen sind jetzt im Salon)";
  } else if (status === "open_closing_soon") {
    realisticHandoverLabel = `noch heute, spätestens aber ${nextOpenLabel}`;
  } else {
    realisticHandoverLabel = nextOpenLabel;
  }

  let nextWorkdayLabel: string;
  if (weekday === "Freitag" || weekday === "Samstag") {
    nextWorkdayLabel = "Montag früh";
  } else if (weekday === "Sonntag") {
    nextWorkdayLabel = "morgen früh"; // Montag
  } else {
    nextWorkdayLabel = "morgen früh";
  }

  return { status, isOpen, nowLabel, reason, nextOpenLabel, realisticHandoverLabel, nextWorkdayLabel, todayWeekday: weekday };
}
