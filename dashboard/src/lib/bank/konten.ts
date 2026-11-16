/** Wofür ein Konto da ist — kurze Info unter der Kontonummer (User 16.11.2026). */
export const KONTO_ZWECK: Record<string, string> = {
  DE55290501010084626019: "Shopify-Konto",
  DE56290501010084626001: "Treatwell-Konto",
  DE21300209005360977267: "Gehaltskonto",
};

export const kontoZweck = (iban: string | null | undefined): string | null => (iban ? KONTO_ZWECK[iban] ?? null : null);
