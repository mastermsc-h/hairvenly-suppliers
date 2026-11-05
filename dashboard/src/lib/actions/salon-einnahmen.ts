"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { requireFeature } from "@/lib/auth";
import { isSalonDevicePaired } from "@/lib/salon/auth";
import { mintKopplungToken } from "@/lib/salon/kopplung-token";
import type { FeatureKey } from "@/lib/types";
import {
  berlinDatum,
  berlinLokalZuIso,
  darfMitarbeiterStornieren,
  parseBetrag,
  pruefeEinnahme,
  type Bereich,
  type EinnahmeArt,
} from "@/lib/salon/einnahmen";

type Svc = ReturnType<typeof createServiceClient>;
type Ergebnis<T> = ({ ok: true } & T) | { ok: false; error: string };

/** Eigener Eintrag, wie ihn der Mitarbeiter am Gerät sieht. */
export interface EigeneEinnahme {
  id: string;
  artName: string;
  bereich: Bereich;
  betrag: number;
  zeitpunkt: string;
  notiz: string | null;
  storniert: boolean;
  stornierbar: boolean;
}

export interface EinnahmenSitzung {
  mitarbeiter: { id: string; name: string; color: string | null };
  arten: EinnahmeArt[];
  heute: EigeneEinnahme[];
}

// Sperre gegen Durchprobieren: so viele Fehlversuche in diesem Zeitfenster (alle Geräte zusammen)
const SPERRE_FEHLVERSUCHE = 10;
const SPERRE_MINUTEN = 10;

async function mitarbeiterPerPin(svc: Svc, pin: string, zweck: string): Promise<Ergebnis<{ ma: { id: string; name: string; color: string | null } }>> {
  if (!(await isSalonDevicePaired())) return { ok: false, error: "Gerät nicht freigeschaltet" };
  if (!/^\d{6}$/.test(pin)) return { ok: false, error: "PIN: 6 Ziffern" };
  const seit = new Date(Date.now() - SPERRE_MINUTEN * 60000).toISOString();
  const { count } = await svc.from("salon_pin_versuche").select("id", { count: "exact", head: true }).eq("ok", false).gte("created_at", seit);
  if ((count ?? 0) >= SPERRE_FEHLVERSUCHE) return { ok: false, error: `Zu viele falsche PINs — bitte ${SPERRE_MINUTEN} Minuten warten` };
  const { data, error } = await svc.from("salon_employees").select("id, name, color").eq("pin", pin).eq("active", true).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) {
    await svc.from("salon_pin_versuche").insert({ ok: false, zweck });
    return { ok: false, error: "PIN nicht erkannt" };
  }
  return { ok: true, ma: data };
}

async function ladeArten(svc: Svc, nurAktive: boolean): Promise<EinnahmeArt[]> {
  let q = svc.from("salon_einnahme_arten").select("id, name, bereich, sortierung, aktiv").order("sortierung").order("name");
  if (nurAktive) q = q.eq("aktiv", true);
  const { data } = await q;
  return (data ?? []).map((a) => ({ id: a.id, name: a.name, bereich: a.bereich as Bereich, sortierung: a.sortierung, aktiv: a.aktiv }));
}

/** Heute erfasste Einträge des Mitarbeiters (auch stornierte, damit nichts „verschwindet"). */
async function heuteVon(svc: Svc, employeeId: string): Promise<EigeneEinnahme[]> {
  const jetzt = new Date();
  const seit = new Date(jetzt.getTime() - 36 * 3600000).toISOString();
  const { data } = await svc
    .from("salon_einnahmen")
    .select("id, art_name, bereich, betrag, zeitpunkt, notiz, storniert_am, created_at")
    .eq("employee_id", employeeId)
    .gte("created_at", seit)
    .order("created_at", { ascending: false });
  return (data ?? [])
    .filter((r) => berlinDatum(r.created_at) === berlinDatum(jetzt))
    .map((r) => ({
      id: r.id,
      artName: r.art_name,
      bereich: r.bereich as Bereich,
      betrag: Number(r.betrag),
      zeitpunkt: r.zeitpunkt,
      notiz: r.notiz,
      storniert: !!r.storniert_am,
      stornierbar: darfMitarbeiterStornieren({ employeeId, storniertAm: r.storniert_am, erfasstAm: r.created_at }, employeeId, jetzt),
    }));
}

/** PIN eingeben → Mitarbeiter, Einnahme-Arten und die eigenen Einträge von heute. */
export async function einnahmenAnmelden(pin: string): Promise<Ergebnis<{ sitzung: EinnahmenSitzung }>> {
  const svc = createServiceClient();
  const r = await mitarbeiterPerPin(svc, pin, "einnahme_login");
  if (!r.ok) return r;
  const [arten, heute] = await Promise.all([ladeArten(svc, true), heuteVon(svc, r.ma.id)]);
  return { ok: true, sitzung: { mitarbeiter: r.ma, arten, heute } };
}

export async function einnahmeErfassen(input: {
  pin: string;
  artId: string;
  betrag: string;
  /** Bremer Ortszeit "YYYY-MM-DDTHH:mm" */
  zeitpunkt: string;
  notiz: string;
}): Promise<Ergebnis<{ heute: EigeneEinnahme[] }>> {
  const svc = createServiceClient();
  const r = await mitarbeiterPerPin(svc, input.pin, "einnahme");
  if (!r.ok) return r;
  const betrag = parseBetrag(input.betrag);
  const zeitpunktIso = berlinLokalZuIso(input.zeitpunkt);
  const notiz = input.notiz.trim() || null;
  const fehler = pruefeEinnahme({ betrag, zeitpunktIso, notiz }, new Date());
  if (fehler) return { ok: false, error: fehler };
  const { data: art } = await svc.from("salon_einnahme_arten").select("id, name, bereich").eq("id", input.artId).eq("aktiv", true).maybeSingle();
  if (!art) return { ok: false, error: "Bitte eine Art auswählen" };
  const { error } = await svc.from("salon_einnahmen").insert({
    employee_id: r.ma.id,
    art_id: art.id,
    art_name: art.name,
    bereich: art.bereich,
    betrag,
    zeitpunkt: zeitpunktIso,
    notiz,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/salon-admin/einnahmen");
  return { ok: true, heute: await heuteVon(svc, r.ma.id) };
}

/** Mitarbeiter: eigenen Eintrag von heute stornieren (bleibt für den Admin sichtbar). */
export async function einnahmeStornierenMitarbeiter(input: { pin: string; id: string }): Promise<Ergebnis<{ heute: EigeneEinnahme[] }>> {
  const svc = createServiceClient();
  const r = await mitarbeiterPerPin(svc, input.pin, "einnahme_storno");
  if (!r.ok) return r;
  const { data: z } = await svc.from("salon_einnahmen").select("employee_id, storniert_am, created_at").eq("id", input.id).maybeSingle();
  if (!z || !darfMitarbeiterStornieren({ employeeId: z.employee_id, storniertAm: z.storniert_am, erfasstAm: z.created_at }, r.ma.id, new Date())) {
    return { ok: false, error: "Nur eigene Einträge von heute können storniert werden" };
  }
  const { error } = await svc.from("salon_einnahmen").update({ storniert_am: new Date().toISOString(), storniert_von: "mitarbeiter" }).eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/salon-admin/einnahmen");
  return { ok: true, heute: await heuteVon(svc, r.ma.id) };
}

// ── Admin ──────────────────────────────────────────────────────

/** Einnahmen sind nur für den Inhaber (role "admin"), nicht für Mitarbeiter mit Salon-Zugriff. */
export async function requireEinnahmenAdmin() {
  const profile = await requireFeature("salon" as FeatureKey);
  if (profile.role !== "admin") redirect("/salon-admin");
  return profile;
}

export async function einnahmeStornoAdmin(id: string, storniert: boolean): Promise<Ergebnis<object>> {
  await requireEinnahmenAdmin();
  const svc = createServiceClient();
  const { error } = await svc
    .from("salon_einnahmen")
    .update(storniert ? { storniert_am: new Date().toISOString(), storniert_von: "admin" } : { storniert_am: null, storniert_von: null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/salon-admin/einnahmen");
  return { ok: true };
}

export async function einnahmeArtSpeichern(input: { id?: string; name: string; bereich: Bereich; sortierung: number; aktiv: boolean }): Promise<Ergebnis<object>> {
  await requireEinnahmenAdmin();
  const name = input.name.trim();
  if (!name || name.length > 60) return { ok: false, error: "Name: 1–60 Zeichen" };
  if (input.bereich !== "verkauf" && input.bereich !== "salon") return { ok: false, error: "Bereich ungültig" };
  const row = { name, bereich: input.bereich, sortierung: Math.round(input.sortierung) || 100, aktiv: input.aktiv };
  const svc = createServiceClient();
  const { error } = input.id
    ? await svc.from("salon_einnahme_arten").update(row).eq("id", input.id)
    : await svc.from("salon_einnahme_arten").insert(row);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/salon-admin/einnahmen");
  return { ok: true };
}

/** QR-Link (15 Min. gültig), der ein Handy/iPad für die Einnahmen-Erfassung freischaltet. */
export async function einnahmenKopplungsLink(): Promise<Ergebnis<{ path: string }>> {
  const profile = await requireEinnahmenAdmin();
  return { ok: true, path: `/salon/koppeln/${mintKopplungToken(profile.id)}` };
}
