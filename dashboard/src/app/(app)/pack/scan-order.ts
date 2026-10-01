/**
 * Bestellnummer aus einem gescannten Lieferschein-QR extrahieren —
 * LAYOUT-UNABHÄNGIG.
 *
 * Ein USB-Handscanner tippt den QR-Inhalt als Tastatureingabe. Auf deutscher
 * Tastatur (QWERTZ) kommen US-Tastencodes verwürfelt an:
 *   https://suppliers.hairvenly.de/pack/27449
 *   → httpsÖ--suppliers.hairvenlz.de-pack-27449   (":"→"Ö", "/"→"-", "y"→"z")
 * Ein Muster wie "/pack/<nr>" matcht das nie. Darum: "pack" + beliebiges
 * Trennzeichen + Ziffern. Die Buchstaben p/a/c/k liegen auf QWERTZ und QWERTY
 * identisch. Die Kamera (iPhone) liefert die URL unverfälscht — deckt der
 * gleiche Ausdruck mit ab.
 *
 * Reine Produkt-Barcodes (z.B. "84379400") liefern null — kein Fehltreffer.
 */
export function extractOrderNumberFromScan(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  // Mind. 4 Ziffern: Bestellnummern sind 5-stellig (#27449). So kann ein
  // abgeschnittener Scan ("…pack-274") nie eine Phantom-Nummer öffnen.
  const m = t.match(/pack[^0-9]{0,3}(\d{4,})/i);
  if (m) return m[1];
  // Fallback: sieht nach unserer URL aus (Domain erkennbar, auch verwürfelt),
  // aber "pack" fehlt/ist zerlegt → letzte Ziffernfolge nehmen.
  if (/hairvenl|suppliers/i.test(t)) {
    const runs = t.match(/\d{4,}/g);
    if (runs) return runs[runs.length - 1];
  }
  return null;
}
