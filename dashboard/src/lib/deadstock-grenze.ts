// Ladenhüter: ab welcher Reichweite ein Produkt als "fast tot" zählt.
// Eine Stelle für die Seite /stock/deadstock (Standard des Umschalters) und das
// Startbildschirm-Fenster "Totes Kapital" — sonst zeigen beide verschiedene Summen.
// Ohne Server-Importe, damit auch Client-Komponenten sie nutzen können.
export const FAST_TOT_MONATE_OPTIONEN = [12, 18, 24] as const;
export const FAST_TOT_STANDARD_MONATE: (typeof FAST_TOT_MONATE_OPTIONEN)[number] = 24;
