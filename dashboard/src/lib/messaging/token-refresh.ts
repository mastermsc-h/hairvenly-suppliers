/**
 * Reine Entscheidungslogik: Soll der Instagram-Token JETZT erneuert werden?
 *
 * Instagram-Regeln für ig_refresh_token:
 *   - Token muss ≥ 24 h alt sein (sonst lehnt die API ab).
 *   - Token darf nicht bereits abgelaufen sein.
 *   - Ein erfolgreicher Refresh verlängert wieder auf ~60 Tage.
 *
 * Strategie (großer Sicherheitspuffer): erneuern, sobald der Token seit dem
 * letzten Refresh ≥ 25 Tage alt ist ODER die Restlaufzeit ≤ 20 Tage beträgt —
 * aber frühestens nach 24 h. Bei 60-Tage-Tokens heißt das: monatlicher Refresh,
 * immer mind. ~30 Tage Puffer, kann praktisch nie ablaufen.
 */
const DAY_MS = 86400000;

export function shouldRefresh(
  now: Date,
  refreshedAt: Date | null,
  expiresAt: Date | null,
): boolean {
  if (!refreshedAt) return true; // unbekannt → sicherheitshalber erneuern
  const ageDays = (now.getTime() - refreshedAt.getTime()) / DAY_MS;
  if (ageDays < 1) return false; // IG-Regel: Token muss ≥ 24 h alt sein
  const remainingDays = expiresAt
    ? (expiresAt.getTime() - now.getTime()) / DAY_MS
    : Infinity;
  return ageDays >= 25 || remainingDays <= 20;
}
