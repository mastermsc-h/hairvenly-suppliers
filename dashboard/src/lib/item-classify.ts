/**
 * Klassifiziert eine Bestellposition: Haar-Extension vs. Zubehör/Pflege/Digital.
 * EINE Quelle der Wahrheit für Pack-Flow (Zubehör-Code, Tags, Foto-Auto-Skip)
 * und Lieferschein. Rein funktional → nutzbar auf Server UND Client.
 *
 * Hintergrund (29.10.2026): Bisher hing die Erkennung NUR an den Shopify-
 * Collections "extensions-zubehoer" / "accessoires-werkzeuge". Beide existieren
 * nicht mehr → ~70 % des Zubehörs galt als Extension, der Zubehör-Code fand
 * "kein offenes Zubehör". Jetzt: Collections (wo noch vorhanden) UND Titel.
 *
 * Sicherheitsrichtung: Im Zweifel "extension". Nicht erkanntes Zubehör muss man
 * nur manuell bestätigen (harmlos); eine als Zubehör verkannte Extension könnte
 * dagegen ohne Barcode-Prüfung durchgewunken werden (schlimm). Validiert gegen
 * alle 596 Shopify-Produkte: 0 Extensions fälschlich als Zubehör.
 */

export type ItemKind = "extension" | "accessory" | "care" | "digital";

const ACCESSORY_HANDLES = new Set(["accessoires-werkzeuge", "extensions-zubehoer"]);
const CARE_HANDLES = new Set(["blessed-haarpflege", "haarpflegeprodukte", "sonstige-haarpflege"]);
const DIGITAL_HANDLES = new Set(["extensions-schulungen"]);

const DIGITAL_RE = /schulung|video-?beratung|\bberatung\b|gutschein|e-?book/i;
const CARE_RE =
  /pflegeprodukt|pflegeset|haarpflege|shampoo|conditioner|masque|haarmask|\bmaske\b|treatment|serum|arganöl|arganoel|biotin|smoothing water|\bspray\b/i;
const ACCESSORY_RE =
  /zubeh(ö|oe)r|bürste|buerste|\bkamm\b|stielkamm|kleber|löser|loeser|entferner|abteilklammer|klammern|zange|faden|schablone|farbring|color ?book|farbbuch|farbmuster|teststr(ä|ae)hne|haarspange|spangen|werkzeug|microringe|nadel|geschenk|verpackung/i;

export function classifyItem(input: {
  title: string;
  collectionHandles?: string[] | null;
}): ItemKind {
  const handles = input.collectionHandles ?? [];
  if (handles.some((h) => DIGITAL_HANDLES.has(h))) return "digital";
  if (handles.some((h) => CARE_HANDLES.has(h))) return "care";
  if (handles.some((h) => ACCESSORY_HANDLES.has(h))) return "accessory";

  const t = input.title ?? "";
  if (DIGITAL_RE.test(t)) return "digital";
  if (CARE_RE.test(t)) return "care";
  if (ACCESSORY_RE.test(t)) return "accessory";
  return "extension";
}

export function isExtensionTitle(title: string, collectionHandles?: string[] | null): boolean {
  return classifyItem({ title, collectionHandles }) === "extension";
}
