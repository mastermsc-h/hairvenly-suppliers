// Browser-Helfer für Z-Bons: Fotos verkleinern, Erkennungsbilder bauen, direkt in den Storage laden.
import { createClient } from "@/lib/supabase/client";
import { zbonUploadVerwerfen, zbonUploadZiele } from "@/lib/actions/z-bons";

// Manche Browser liefern HEIC ohne MIME-Typ
export function mimeVon(f: File): string {
  if (f.type) return f.type;
  const ext = f.name.split(".").pop()?.toLowerCase();
  return ext === "heic" ? "image/heic" : ext === "heif" ? "image/heif" : ext === "pdf" ? "application/pdf" : "";
}

async function zuJpeg(canvas: HTMLCanvasElement, q: number): Promise<Blob | null> {
  return new Promise((r) => canvas.toBlob(r, "image/jpeg", q));
}

/** Fotos auf max. 3200 px (lange Kante) als JPEG — Bon-Text bleibt scharf, Upload bleibt klein. */
export async function verkleinere(file: File): Promise<File> {
  const type = mimeVon(file);
  if (!type.startsWith("image/")) return file;
  try {
    const bmp = await createImageBitmap(file);
    const f = Math.min(1, 3200 / Math.max(bmp.width, bmp.height));
    if (f === 1 && type === "image/jpeg" && file.size < 2_000_000) {
      bmp.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * f);
    canvas.height = Math.round(bmp.height * f);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await zuJpeg(canvas, 0.85);
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file; // nicht dekodierbar (z.B. HEIC in Chrome) → Original hochladen
  }
}

async function base64(blob: Blob): Promise<string> {
  const url = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
  return url.slice(url.indexOf(",") + 1);
}

/**
 * Bilder für die KI-Erkennung. Lange, schmale Bons werden in überlappende Abschnitte geteilt —
 * sonst verkleinert die Erkennung das ganze Foto so stark, dass Datum und Summe unlesbar werden.
 */
export async function erkennungsInput(files: File[]): Promise<{ bilder: string[]; pdf: string | null }> {
  const bilder: string[] = [];
  let pdf: string | null = null;
  let budget = 3_500_000; // Zeichen Base64 — unter dem Request-Limit bleiben
  for (const file of files) {
    const type = mimeVon(file);
    if (type === "application/pdf") {
      if (!pdf && file.size < 2_500_000) {
        pdf = await base64(file);
        budget -= pdf.length;
      }
      continue;
    }
    if (!type.startsWith("image/") || bilder.length >= 8) continue;
    try {
      const bmp = await createImageBitmap(file);
      const { width: w, height: h } = bmp;
      const hoch = h > w;
      // Abschnitte entlang der langen Kante, je ca. 1:1,4, 10 % Überlappung, max. 4
      const lang = hoch ? h : w, kurz = hoch ? w : h;
      const stueck = lang > kurz * 1.8 ? Math.round(kurz * 1.4) : lang;
      const schritt = Math.round(stueck * 0.9);
      let teile = 0;
      for (let start = 0; start < lang && bilder.length < 8 && teile < 4; start += schritt) {
        teile++;
        const len = Math.min(stueck, lang - start);
        const sw = hoch ? w : len, sh = hoch ? len : h;
        const f = Math.min(1, 1568 / Math.max(sw, sh));
        const c = document.createElement("canvas");
        c.width = Math.round(sw * f);
        c.height = Math.round(sh * f);
        c.getContext("2d")!.drawImage(bmp, hoch ? 0 : start, hoch ? start : 0, sw, sh, 0, 0, c.width, c.height);
        const blob = await zuJpeg(c, 0.8);
        if (blob) {
          const b = await base64(blob);
          if (b.length > budget) break;
          budget -= b.length;
          bilder.push(b);
        }
        if (start + len >= lang) break;
      }
      bmp.close();
    } catch {
      // nicht dekodierbar → ohne dieses Bild erkennen
    }
  }
  return { bilder, pdf };
}

export type Hochgeladen = { pfad: string; name: string; type: string; size: number };

/** Lädt die (bereits verkleinerten) Dateien per signierter URL hoch; bei Fehler wird aufgeräumt. */
export async function ladeHoch(ordnerDatum: string, files: File[], onSchritt?: (i: number, n: number) => void): Promise<Hochgeladen[]> {
  const meta = files.map((f) => ({ name: f.name, type: mimeVon(f), size: f.size }));
  const ziele = await zbonUploadZiele(ordnerDatum, meta);
  if (!ziele.ok) throw new Error(ziele.error);
  const sb = createClient();
  const fertig: Hochgeladen[] = [];
  try {
    for (let i = 0; i < files.length; i++) {
      onSchritt?.(i + 1, files.length);
      const z = ziele.ziele[i];
      const { error } = await sb.storage.from("z-bons").uploadToSignedUrl(z.pfad, z.token, files[i], { contentType: meta[i].type });
      if (error) throw new Error(`${meta[i].name}: ${error.message}`);
      fertig.push({ ...meta[i], pfad: z.pfad });
    }
  } catch (e) {
    if (fertig.length) await zbonUploadVerwerfen(fertig.map((f) => f.pfad)).catch(() => {});
    throw e;
  }
  return fertig;
}
