"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { requireFeature } from "@/lib/auth";
import { erkenneZBon } from "@/lib/z-bons/erkennung";
import { heuteBerlin, zbonLage } from "@/lib/z-bons/pruefung";
import type { ZBon, ZBonErkennung, ZBonFehlend, ZBonQuelle, ZBonStatus } from "@/lib/types";

const PATH = "/finances/z-bons";
const BUCKET = "z-bons";
const MAX_BYTES = 25 * 1024 * 1024;
const MIMES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const QUELLEN: ZBonQuelle[] = ["shopify_pos", "nexi"];
// Nur Pfade, die zbonUploadZiele erzeugt hat (YYYY-MM/uuid-name)
const PFAD_RE = /^\d{4}-\d{2}\/[0-9a-f-]{36}-[\w.\-]{1,120}$/;

const istDatum = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Alle Z-Bons eines Monats (ohne gelöschte), mit Dateien. */
export async function fetchZBons(jahr: number, monat: number): Promise<ZBon[]> {
  await requireFeature("finances");
  const von = `${jahr}-${String(monat).padStart(2, "0")}-01`;
  const bis = monat === 12 ? `${jahr + 1}-01-01` : `${jahr}-${String(monat + 1).padStart(2, "0")}-01`;
  const svc = createServiceClient();
  const { data, error } = await svc
    .from("z_bons")
    .select("id, datum, quelle, betrag, notiz, created_at, uploader:profiles!z_bons_hochgeladen_von_fkey(display_name, username, email), z_bon_dateien(id, pfad, dateiname, mime, groesse, reihenfolge)")
    .is("geloescht_am", null)
    .gte("datum", von)
    .lt("datum", bis)
    .order("datum", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  type P = { display_name: string | null; username: string | null; email: string | null } | null;
  return (data ?? []).map((r) => {
    const p = (Array.isArray(r.uploader) ? r.uploader[0] : r.uploader) as P;
    return {
      id: r.id,
      datum: r.datum,
      quelle: r.quelle as ZBonQuelle,
      betrag: r.betrag == null ? null : Number(r.betrag),
      notiz: r.notiz,
      hochgeladen_von_name: p ? p.display_name || p.username || p.email : null,
      created_at: r.created_at,
      dateien: [...(r.z_bon_dateien ?? [])]
        .sort((a, b) => a.reihenfolge - b.reihenfolge)
        .map((d) => ({ id: d.id, pfad: d.pfad, dateiname: d.dateiname, mime: d.mime, groesse: d.groesse })),
    };
  });
}

/**
 * Signierte Upload-Ziele: der Browser lädt direkt in den Storage hoch (Vercel nimmt in
 * Server-Requests nur ~4,5 MB an — PDFs/Fotos können größer sein).
 */
export async function zbonUploadZiele(
  datum: string,
  dateien: Array<{ name: string; type: string; size: number }>,
): Promise<{ ok: true; ziele: Array<{ pfad: string; token: string }> } | { ok: false; error: string }> {
  await requireFeature("finances");
  if (!istDatum(datum)) return { ok: false, error: "Ungültiges Datum" };
  if (!dateien.length || dateien.length > 20) return { ok: false, error: "1 bis 20 Dateien pro Z-Bon" };
  for (const d of dateien) {
    if (!MIMES.includes(d.type)) return { ok: false, error: `Dateityp nicht erlaubt: ${d.name} (nur PDF, JPG, PNG, WEBP, HEIC)` };
    if (d.size > MAX_BYTES) return { ok: false, error: `${d.name} ist größer als 25 MB` };
  }
  const svc = createServiceClient();
  const ziele: Array<{ pfad: string; token: string }> = [];
  for (const d of dateien) {
    const safe = d.name.replace(/[^\w.\-]+/g, "_").slice(-100) || "datei";
    const pfad = `${datum.slice(0, 7)}/${randomUUID()}-${safe}`;
    const { data, error } = await svc.storage.from(BUCKET).createSignedUploadUrl(pfad);
    if (error || !data) return { ok: false, error: error?.message ?? "Upload-URL fehlgeschlagen" };
    ziele.push({ pfad, token: data.token });
  }
  return { ok: true, ziele };
}

/** Z-Bon anlegen, nachdem die Dateien hochgeladen sind. */
export async function zbonSpeichern(input: {
  datum: string;
  quelle: ZBonQuelle;
  betrag: number | null;
  notiz: string;
  dateien: Array<{ pfad: string; name: string; type: string; size: number }>;
  erkannt?: ZBonErkennung | null;
  automatisch?: boolean;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const profile = await requireFeature("finances");
  if (!istDatum(input.datum)) return { ok: false, error: "Ungültiges Datum" };
  if (!QUELLEN.includes(input.quelle)) return { ok: false, error: "Ungültige Kasse" };
  if (!input.dateien.length) return { ok: false, error: "Keine Datei" };
  // Ordner = Upload-Monat (der Scanner lädt hoch, bevor das Bon-Datum erkannt ist)
  if (input.dateien.some((d) => !PFAD_RE.test(d.pfad))) return { ok: false, error: "Ungültiger Dateipfad" };
  const betrag = input.betrag == null || !Number.isFinite(input.betrag) ? null : Math.round(input.betrag * 100) / 100;
  const svc = createServiceClient();

  // Nur tatsächlich hochgeladene Dateien verknüpfen
  const namen = new Set<string>();
  for (const ordner of new Set(input.dateien.map((d) => d.pfad.slice(0, 7)))) {
    const { data: vorhanden, error: listErr } = await svc.storage.from(BUCKET).list(ordner, { limit: 1000, sortBy: { column: "created_at", order: "desc" } });
    if (listErr) return { ok: false, error: listErr.message };
    for (const o of vorhanden ?? []) namen.add(`${ordner}/${o.name}`);
  }
  const fehlt = input.dateien.find((d) => !namen.has(d.pfad));
  if (fehlt) return { ok: false, error: `Upload von ${fehlt.name} nicht angekommen — bitte nochmal versuchen` };

  const { data: bon, error } = await svc
    .from("z_bons")
    .insert({
      datum: input.datum,
      quelle: input.quelle,
      betrag,
      notiz: input.notiz.trim().slice(0, 500) || null,
      hochgeladen_von: profile.id,
      erkannt: input.erkannt ?? null,
      automatisch: input.automatisch === true,
    })
    .select("id")
    .single();
  if (error || !bon) return { ok: false, error: error?.message ?? "Speichern fehlgeschlagen" };

  const { error: e2 } = await svc.from("z_bon_dateien").insert(
    input.dateien.map((d, i) => ({
      z_bon_id: bon.id,
      pfad: d.pfad,
      dateiname: d.name.slice(0, 200),
      mime: MIMES.includes(d.type) ? d.type : "application/octet-stream",
      groesse: Math.max(0, Math.round(d.size)),
      reihenfolge: i,
    })),
  );
  if (e2) {
    await svc.from("z_bons").delete().eq("id", bon.id);
    return { ok: false, error: e2.message };
  }
  revalidatePath(PATH);
  return { ok: true, id: bon.id };
}

/** Kasse/Datum/Umsatz vom Bon lesen lassen (Bilder als JPEG-Base64, optional ein PDF). */
export async function zbonErkennen(input: { bilder: string[]; pdf?: string | null }): Promise<ZBonErkennung> {
  await requireFeature("finances");
  const bilder = (Array.isArray(input.bilder) ? input.bilder : []).filter((b) => typeof b === "string").slice(0, 8);
  const pdf = typeof input.pdf === "string" ? input.pdf : null;
  const groesse = bilder.reduce((s, b) => s + b.length, 0) + (pdf?.length ?? 0);
  if (groesse > 4_000_000) {
    return { ist_z_bon: false, kasse: "unklar", datum: null, umsatz_brutto: null, sicherheit: "niedrig", hinweis: "Datei zu groß für die Erkennung" };
  }
  return erkenneZBon({ bilder, pdf }, heuteBerlin());
}

/** Kasse/Datum/Umsatz eines Z-Bons korrigieren (z.B. nach automatischer Erkennung). */
export async function zbonAendern(
  id: string,
  felder: { quelle: ZBonQuelle; datum: string; betrag: number | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireFeature("finances");
  if (!istDatum(felder.datum) || felder.datum > heuteBerlin()) return { ok: false, error: "Ungültiges Datum" };
  if (!QUELLEN.includes(felder.quelle)) return { ok: false, error: "Ungültige Kasse" };
  const betrag = felder.betrag == null || !Number.isFinite(felder.betrag) ? null : Math.round(felder.betrag * 100) / 100;
  const svc = createServiceClient();
  const { error } = await svc
    .from("z_bons")
    .update({ quelle: felder.quelle, datum: felder.datum, betrag })
    .eq("id", id)
    .is("geloescht_am", null);
  if (error) return { ok: false, error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}

/** Erwartete/fehlende Bons eines Monats (bis heute) + letzter Wochencheck. */
export async function fetchZBonStatus(jahr: number, monat: number): Promise<ZBonStatus> {
  await requireFeature("finances");
  const svc = createServiceClient();
  const von = `${jahr}-${String(monat).padStart(2, "0")}-01`;
  const ende = new Date(Date.UTC(jahr, monat, 0)).toISOString().slice(0, 10);
  const heute = heuteBerlin();
  const bis = ende < heute ? ende : heute;
  const [lage, pruef] = await Promise.all([
    von <= bis ? zbonLage(svc, von, bis) : null,
    svc.from("z_bon_pruefungen").select("von, bis, fehlend, geprueft_am, mail_status").order("geprueft_am", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const einst = lage?.einst ?? ((await svc.from("z_bon_einstellungen").select("pruef_ab, nexi_wochentage").eq("id", 1).single()).data as ZBonStatus["einstellungen"]);
  return {
    fehlend: lage?.fehlend ?? [],
    erwartet: lage?.erwartet ?? [],
    posUmsatz: lage?.posUmsatz ?? {},
    ausnahmen: lage?.ausnahmen ?? [],
    einstellungen: einst,
    letztePruefung: pruef.data
      ? { ...pruef.data, fehlend: (pruef.data.fehlend ?? []) as ZBonFehlend[] }
      : null,
  };
}

/** Tag als „kein Z-Bon nötig" markieren (geschlossen, Kasse nicht benutzt …). */
export async function zbonAusnahmeSetzen(datum: string, quelle: ZBonQuelle, grund: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const profile = await requireFeature("finances");
  if (!istDatum(datum) || !QUELLEN.includes(quelle)) return { ok: false, error: "Ungültige Angabe" };
  if (!grund.trim()) return { ok: false, error: "Bitte einen Grund angeben" };
  const svc = createServiceClient();
  const { error } = await svc
    .from("z_bon_ausnahmen")
    .upsert({ datum, quelle, grund: grund.trim().slice(0, 200), erstellt_von: profile.id }, { onConflict: "datum,quelle" });
  if (error) return { ok: false, error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}

export async function zbonAusnahmeEntfernen(datum: string, quelle: ZBonQuelle): Promise<void> {
  await requireFeature("finances");
  const svc = createServiceClient();
  await svc.from("z_bon_ausnahmen").delete().eq("datum", datum).eq("quelle", quelle);
  revalidatePath(PATH);
}

/** Prüfregeln: ab wann geprüft wird + an welchen Wochentagen (0=So … 6=Sa) Nexi-Bons erwartet werden. */
export async function zbonEinstellungenSpeichern(pruefAb: string, nexiWochentage: number[]): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireFeature("finances");
  if (!istDatum(pruefAb)) return { ok: false, error: "Ungültiges Datum" };
  const tage = Array.from(new Set(nexiWochentage.filter((t) => Number.isInteger(t) && t >= 0 && t <= 6))).sort();
  const svc = createServiceClient();
  const { error } = await svc
    .from("z_bon_einstellungen")
    .update({ pruef_ab: pruefAb, nexi_wochentage: tage, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) return { ok: false, error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}

/** Upload abgebrochen/fehlgeschlagen: bereits hochgeladene, nicht verknüpfte Dateien entfernen. */
export async function zbonUploadVerwerfen(pfade: string[]): Promise<void> {
  await requireFeature("finances");
  const ok = pfade.filter((p) => PFAD_RE.test(p));
  if (!ok.length) return;
  const svc = createServiceClient();
  const { data: verknuepft } = await svc.from("z_bon_dateien").select("pfad").in("pfad", ok);
  const frei = ok.filter((p) => !(verknuepft ?? []).some((v) => v.pfad === p));
  if (frei.length) await svc.storage.from(BUCKET).remove(frei);
}

/** Signierte Ansichts-URL (10 Min). */
export async function zbonDateiUrl(pfad: string, download = false): Promise<string | null> {
  await requireFeature("finances");
  if (!PFAD_RE.test(pfad)) return null;
  const svc = createServiceClient();
  const name = pfad.split("/").pop()!.slice(37);
  const { data, error } = await svc.storage.from(BUCKET).createSignedUrl(pfad, 600, download ? { download: name } : undefined);
  return error ? null : data.signedUrl;
}

/** Löschen = als gelöscht markieren (Kassenbelege sind aufbewahrungspflichtig). */
export async function zbonLoeschen(id: string, grund: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const profile = await requireFeature("finances");
  if (!grund.trim()) return { ok: false, error: "Bitte einen Grund angeben" };
  const svc = createServiceClient();
  const { error } = await svc
    .from("z_bons")
    .update({ geloescht_am: new Date().toISOString(), geloescht_von: profile.id, geloescht_grund: grund.trim().slice(0, 300) })
    .eq("id", id)
    .is("geloescht_am", null);
  if (error) return { ok: false, error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}
