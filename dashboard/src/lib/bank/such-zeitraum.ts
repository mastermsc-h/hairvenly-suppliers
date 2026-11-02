// Zeitraum-Auswahl der Suchen in Kontoumsätzen und Zahlungseingängen.
const MONATSNAMEN = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const DATEN_AB = "2025-07"; // Kontoumsätze liegen ab Juli 2025 vor

/** Monate für die Zeitraum-Auswahl: aktueller Monat zurück bis Datenbeginn. */
export function suchMonate(): string[] {
  const out: string[] = [];
  const d = new Date();
  let y = d.getFullYear();
  let m = d.getMonth() + 1;
  for (let i = 0; i < 60; i++) {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    if (k < DATEN_AB) break;
    out.push(k);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}
export function monatName(k: string): string {
  const [y, m] = k.split("-").map(Number);
  return `${MONATSNAMEN[m - 1]} ${y}`;
}
export function monatGrenzen(k: string): { von: string; bis: string } | null {
  if (!k) return null;
  const [y, m] = k.split("-").map(Number);
  return { von: `${k}-01`, bis: `${k}-${new Date(Date.UTC(y, m, 0)).getUTCDate()}` };
}
