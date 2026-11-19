"use server";

// Passwort-Tresor (/admin/passwoerter). Der Server sieht nur Chiffretexte:
// Verschlüsselung und Entschlüsselung passieren im Browser mit dem Master-Passwort.
// Jede Aktion prüft role === "admin" (Mitarbeiter haben is_admin=true, dürfen hier aber nicht rein).
import { requireProfile } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

export type TresorMeta = {
  salt: string;
  iterationen: number;
  pruef_iv: string;
  pruef_chiffre: string;
};

export type TresorEintragRoh = {
  id: string;
  iv: string;
  chiffre: string;
  geaendert_am: string;
};

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_CHIFFRE = 200_000;

async function nurAdmin() {
  const profile = await requireProfile();
  if (profile.role !== "admin") throw new Error("Kein Zugriff");
  return profile;
}

function pruefeBlob(iv: string, chiffre: string) {
  if (!B64.test(iv) || iv.length > 32) throw new Error("Ungültiger IV");
  if (!B64.test(chiffre) || chiffre.length > MAX_CHIFFRE) throw new Error("Ungültiger Inhalt");
}

export async function ladeTresor(): Promise<{ meta: TresorMeta | null; eintraege: TresorEintragRoh[] }> {
  await nurAdmin();
  const svc = createServiceClient();
  const [{ data: meta }, { data: eintraege, error }] = await Promise.all([
    svc.from("passwort_tresor_meta").select("salt, iterationen, pruef_iv, pruef_chiffre").eq("id", 1).maybeSingle(),
    svc.from("passwort_tresor_eintraege").select("id, iv, chiffre, geaendert_am").order("erstellt_am"),
  ]);
  if (error) throw new Error(error.message);
  return { meta: (meta as TresorMeta) ?? null, eintraege: (eintraege as TresorEintragRoh[]) ?? [] };
}

/** Erstes Einrichten des Master-Passworts — nur wenn noch keins existiert. */
export async function richteTresorEin(meta: TresorMeta) {
  await nurAdmin();
  pruefeBlob(meta.pruef_iv, meta.pruef_chiffre);
  if (!B64.test(meta.salt)) throw new Error("Ungültiges Salt");
  const svc = createServiceClient();
  const { data: vorhanden } = await svc.from("passwort_tresor_meta").select("id").eq("id", 1).maybeSingle();
  if (vorhanden) throw new Error("Tresor ist bereits eingerichtet");
  const { error } = await svc.from("passwort_tresor_meta").insert({ id: 1, ...meta });
  if (error) throw new Error(error.message);
}

export async function speichereEintrag(input: { id?: string; iv: string; chiffre: string }) {
  const profile = await nurAdmin();
  pruefeBlob(input.iv, input.chiffre);
  const svc = createServiceClient();
  if (input.id) {
    const { error } = await svc
      .from("passwort_tresor_eintraege")
      .update({ iv: input.iv, chiffre: input.chiffre, geaendert_am: new Date().toISOString() })
      .eq("id", input.id);
    if (error) throw new Error(error.message);
    return input.id;
  }
  const { data, error } = await svc
    .from("passwort_tresor_eintraege")
    .insert({ iv: input.iv, chiffre: input.chiffre, erstellt_von: profile.id })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function loescheEintrag(id: string) {
  await nurAdmin();
  const svc = createServiceClient();
  const { error } = await svc.from("passwort_tresor_eintraege").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Master-Passwort ändern: Der Browser hat alle Einträge mit dem neuen Schlüssel neu verschlüsselt.
 * Es müssen exakt alle vorhandenen Einträge mitkommen, sonst wären einzelne nicht mehr lesbar.
 */
export async function aendereMasterPasswort(
  meta: TresorMeta,
  eintraege: { id: string; iv: string; chiffre: string }[],
) {
  await nurAdmin();
  pruefeBlob(meta.pruef_iv, meta.pruef_chiffre);
  eintraege.forEach((e) => pruefeBlob(e.iv, e.chiffre));
  const svc = createServiceClient();
  const { data: ids } = await svc.from("passwort_tresor_eintraege").select("id");
  const vorhanden = new Set((ids ?? []).map((r) => r.id as string));
  const neu = new Set(eintraege.map((e) => e.id));
  if (vorhanden.size !== neu.size || [...vorhanden].some((id) => !neu.has(id))) {
    throw new Error("Einträge haben sich inzwischen geändert — bitte Seite neu laden und nochmal versuchen.");
  }
  const jetzt = new Date().toISOString();
  for (const e of eintraege) {
    const { error } = await svc
      .from("passwort_tresor_eintraege")
      .update({ iv: e.iv, chiffre: e.chiffre, geaendert_am: jetzt })
      .eq("id", e.id);
    if (error) throw new Error(error.message);
  }
  const { error } = await svc
    .from("passwort_tresor_meta")
    .update({ ...meta, geaendert_am: jetzt })
    .eq("id", 1);
  if (error) throw new Error(error.message);
}
