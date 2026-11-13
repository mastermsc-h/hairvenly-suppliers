"use server";

// Startbildschirm ("Cockpit"): Anordnung speichern + Einträge pflegen.
// Rechte: Lieferanten nie. Notizen gehören einer Person. Ideen und Aufgaben darf das ganze
// Team anlegen/ändern. Meilensteine, Wachstumspfeiler, Aktionen, Philosophie nur Admins.
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { WIDGETS, type CockpitLayout, type Eintrag, type EintragArt, type EintragDaten } from "@/lib/cockpit/typen";

type Ergebnis<T = undefined> = { ok: true; wert?: T } | { ok: false; error: string };

const ARTEN: EintragArt[] = ["notiz", "idee", "aufgabe", "meilenstein", "pfeiler", "aktion", "philosophie"];
const NUR_ADMIN: EintragArt[] = ["meilenstein", "pfeiler", "aktion", "philosophie"];
const WIDGET_IDS = new Set<string>(WIDGETS.map((w) => w.id));

async function team() {
  const profile = await requireProfile();
  if (profile.role === "supplier") return null;
  return profile;
}

function saubereDaten(d: EintragDaten | undefined): EintragDaten {
  const out: EintragDaten = {};
  if (!d) return out;
  const datum = (s: unknown) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
  if (typeof d.farbe === "string" && d.farbe.length <= 20) out.farbe = d.farbe;
  if (datum(d.faellig)) out.faellig = d.faellig;
  if (datum(d.von)) out.von = d.von;
  if (datum(d.bis)) out.bis = d.bis;
  if (typeof d.zustaendig === "string") out.zustaendig = d.zustaendig.slice(0, 60);
  if (d.prio === "hoch" || d.prio === "normal") out.prio = d.prio;
  if (typeof d.fortschritt === "number" && Number.isFinite(d.fortschritt)) out.fortschritt = Math.max(0, Math.min(100, Math.round(d.fortschritt)));
  if (typeof d.link === "string" && /^https?:\/\//.test(d.link)) out.link = d.link.slice(0, 500);
  return out;
}

export async function speichereCockpitLayout(layout: CockpitLayout): Promise<Ergebnis> {
  const profile = await team();
  if (!profile) return { ok: false, error: "Kein Zugriff" };
  const zahl = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n < 1000;
  const items = (Array.isArray(layout?.items) ? layout.items : [])
    .filter((it) => WIDGET_IDS.has(it?.i) && zahl(it.x) && zahl(it.y) && zahl(it.w) && zahl(it.h))
    .map((it) => ({ i: it.i, x: it.x, y: it.y, w: it.w, h: it.h }));
  const aus = (Array.isArray(layout?.aus) ? layout.aus : []).filter((id) => WIDGET_IDS.has(id));
  const { error } = await createServiceClient()
    .from("cockpit_layout")
    .upsert({ user_id: profile.id, layout: { items, aus, adern: layout?.adern !== false, abstand: typeof layout?.abstand === "number" && Number.isFinite(layout.abstand) ? Math.max(4, Math.min(32, Math.round(layout.abstand))) : 12 }, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function cockpitLayoutZuruecksetzen(): Promise<Ergebnis> {
  const profile = await team();
  if (!profile) return { ok: false, error: "Kein Zugriff" };
  const { error } = await createServiceClient().from("cockpit_layout").delete().eq("user_id", profile.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/start");
  return { ok: true };
}

export async function erstelleEintrag(input: { art: EintragArt; titel?: string; text?: string; daten?: EintragDaten }): Promise<Ergebnis<Eintrag>> {
  const profile = await team();
  if (!profile) return { ok: false, error: "Kein Zugriff" };
  if (!ARTEN.includes(input.art)) return { ok: false, error: "Unbekannte Art" };
  if (NUR_ADMIN.includes(input.art) && profile.role !== "admin") return { ok: false, error: "Nur Admins" };
  const sb = createServiceClient();
  const { data, error } = await sb
    .from("cockpit_eintraege")
    .insert({
      art: input.art,
      owner_id: profile.id,
      titel: (input.titel ?? "").trim().slice(0, 200),
      text: (input.text ?? "").slice(0, 5000),
      daten: saubereDaten(input.daten),
      sort: Date.now() / 1000,
    })
    .select("id, art, owner_id, titel, text, daten, erledigt_am, sort, created_at")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Speichern fehlgeschlagen" };
  return { ok: true, wert: { ...(data as Omit<Eintrag, "owner_name">), owner_name: profile.display_name ?? profile.username ?? null } };
}

/** Darf diese Person den Eintrag ändern? Gibt den Eintrag zurück oder einen Fehlertext. */
async function pruefe(id: string): Promise<{ art: EintragArt; owner_id: string | null } | string> {
  const profile = await team();
  if (!profile) return "Kein Zugriff";
  const { data } = await createServiceClient().from("cockpit_eintraege").select("art, owner_id").eq("id", id).maybeSingle();
  if (!data) return "Eintrag nicht gefunden";
  const e = data as { art: EintragArt; owner_id: string | null };
  if (e.art === "notiz" && e.owner_id !== profile.id) return "Das ist nicht deine Notiz";
  if (NUR_ADMIN.includes(e.art) && profile.role !== "admin") return "Nur Admins";
  return e;
}

export async function aendereEintrag(
  id: string,
  patch: { titel?: string; text?: string; daten?: EintragDaten; erledigt?: boolean; sort?: number },
): Promise<Ergebnis> {
  const e = await pruefe(id);
  if (typeof e === "string") return { ok: false, error: e };
  const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.titel !== undefined) upd.titel = patch.titel.trim().slice(0, 200);
  if (patch.text !== undefined) upd.text = patch.text.slice(0, 5000);
  if (patch.daten !== undefined) upd.daten = saubereDaten(patch.daten);
  if (patch.erledigt !== undefined) upd.erledigt_am = patch.erledigt ? new Date().toISOString() : null;
  if (typeof patch.sort === "number" && Number.isFinite(patch.sort)) upd.sort = patch.sort;
  const { error } = await createServiceClient().from("cockpit_eintraege").update(upd).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function loescheEintrag(id: string): Promise<Ergebnis> {
  const e = await pruefe(id);
  if (typeof e === "string") return { ok: false, error: e };
  const { error } = await createServiceClient().from("cockpit_eintraege").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}
