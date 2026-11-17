"use server";

// Preislisten der Lieferanten als Dokumente (PDF/PNG/JPG) — Ablage unter /prices.
// Enthalten Einkaufspreise → nur echte Admins (role 'admin'), wie die EK-Spalten der Preistabelle.
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import type { LieferantenPreisliste } from "@/lib/types";

const BUCKET = "lieferanten-preislisten";
const MAX_BYTES = 9 * 1024 * 1024; // Server-Action-Limit ist 10 MB inkl. Overhead
const ENDUNG: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

type Ergebnis = { ok: true } | { ok: false; error: string };

async function nurAdmin() {
  const profile = await requireProfile();
  return profile.role === "admin" ? profile : null;
}

const sauber = (s: unknown, max: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export async function ladePreislistenDokumente(): Promise<LieferantenPreisliste[]> {
  if (!(await nurAdmin())) return [];
  const sb = createServiceClient();
  const { data, error } = await sb
    .from("lieferanten_preislisten")
    .select("id, lieferant, titel, gueltig_ab, pfad, dateiname, mime, groesse, created_at")
    .order("created_at", { ascending: false });
  if (error || !data?.length) return [];
  const { data: links } = await sb.storage.from(BUCKET).createSignedUrls(data.map((d) => d.pfad), 3600);
  const url = new Map((links ?? []).map((l) => [l.path, l.signedUrl]));
  return data.map(({ pfad, ...d }) => ({ ...d, url: url.get(pfad) ?? null }));
}

export async function preislisteHochladen(formData: FormData): Promise<Ergebnis> {
  const profile = await nurAdmin();
  if (!profile) return { ok: false, error: "Nur für Admins" };
  const datei = formData.get("datei");
  if (!(datei instanceof File) || !datei.size) return { ok: false, error: "Keine Datei" };
  const endung = ENDUNG[datei.type];
  if (!endung) return { ok: false, error: "Nur PDF, PNG, JPG oder WebP" };
  if (datei.size > MAX_BYTES) return { ok: false, error: "Datei zu groß (max. 9 MB)" };
  const lieferant = sauber(formData.get("lieferant"), 60);
  if (!lieferant) return { ok: false, error: "Lieferant fehlt" };
  const gueltig = sauber(formData.get("gueltig_ab"), 10);
  const gueltigAb = /^\d{4}-\d{2}-\d{2}$/.test(gueltig) ? gueltig : null;
  const ordner = lieferant.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "lieferant";
  const pfad = `${ordner}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${endung}`;

  const sb = createServiceClient();
  const { error: e1 } = await sb.storage.from(BUCKET).upload(pfad, datei, { contentType: datei.type });
  if (e1) return { ok: false, error: e1.message };
  const { error: e2 } = await sb.from("lieferanten_preislisten").insert({
    lieferant,
    titel: sauber(formData.get("titel"), 120),
    gueltig_ab: gueltigAb,
    pfad,
    dateiname: sauber(datei.name, 200) || `preisliste.${endung}`,
    mime: datei.type,
    groesse: datei.size,
    hochgeladen_von: profile.id,
  });
  if (e2) {
    await sb.storage.from(BUCKET).remove([pfad]); // keine verwaiste Datei
    return { ok: false, error: e2.message };
  }
  revalidatePath("/prices");
  return { ok: true };
}

export async function preislisteLoeschen(id: string): Promise<Ergebnis> {
  if (!(await nurAdmin())) return { ok: false, error: "Nur für Admins" };
  const sb = createServiceClient();
  const { data } = await sb.from("lieferanten_preislisten").select("pfad").eq("id", id).maybeSingle();
  if (!data) return { ok: false, error: "Nicht gefunden" };
  const { error } = await sb.from("lieferanten_preislisten").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  await sb.storage.from(BUCKET).remove([data.pfad]);
  revalidatePath("/prices");
  return { ok: true };
}
