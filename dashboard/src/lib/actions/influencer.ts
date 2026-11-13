"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";

type Ergebnis = { ok?: boolean; error?: string };

const PLATTFORMEN = ["instagram", "tiktok", "youtube", "sonstiges"];
const ARTEN = ["reel", "story", "post", "video", "live", "sonstiges"];
const DATUM = /^\d{4}-\d{2}-\d{2}$/;

const text = (f: FormData, k: string, max = 300) => {
  const v = String(f.get(k) ?? "").trim().slice(0, max);
  return v || null;
};
const datum = (f: FormData, k: string) => {
  const v = text(f, k, 10);
  return v && DATUM.test(v) ? v : null;
};

async function adminClient() {
  const profile = await requireProfile();
  if (!profile.is_admin) throw new Error("Nur Admins");
  return createClient(); // RLS: nur Admins dürfen influencer*/schreiben
}

export async function speichereInfluencer(f: FormData): Promise<Ergebnis> {
  try {
    const sb = await adminClient();
    const id = text(f, "id", 40);
    const name = text(f, "name", 120);
    if (!name) return { error: "Name fehlt" };
    const plattform = text(f, "plattform", 20) ?? "instagram";
    if (!PLATTFORMEN.includes(plattform)) return { error: "Unbekannte Plattform" };
    const kostenRoh = text(f, "kosten_eur", 20);
    const kosten = kostenRoh ? Number(kostenRoh.replace(/\./g, "").replace(",", ".")) : null;
    if (kosten !== null && !Number.isFinite(kosten)) return { error: "Kosten ist keine Zahl" };
    const handle = text(f, "handle", 80);
    const zeile = {
      name,
      handle: handle ? (handle.startsWith("@") ? handle : `@${handle}`) : null,
      plattform,
      rabattcode: text(f, "rabattcode", 60)?.toUpperCase() ?? null,
      aktiv_von: datum(f, "aktiv_von"),
      aktiv_bis: datum(f, "aktiv_bis"),
      kosten_eur: kosten,
      verguetung: text(f, "verguetung", 200),
      notiz: text(f, "notiz", 1000),
    };
    const { error } = id ? await sb.from("influencer").update(zeile).eq("id", id) : await sb.from("influencer").insert(zeile);
    if (error) return { error: error.code === "23505" ? "Dieser Rabattcode ist schon einem Influencer zugeordnet" : error.message };
    revalidatePath("/marketing/aktionen");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Fehler" };
  }
}

export async function loescheInfluencer(id: string): Promise<Ergebnis> {
  try {
    const sb = await adminClient();
    const { error } = await sb.from("influencer").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/marketing/aktionen");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Fehler" };
  }
}

export async function speicherePosting(f: FormData): Promise<Ergebnis> {
  try {
    const sb = await adminClient();
    const influencer_id = text(f, "influencer_id", 40);
    const d = datum(f, "datum");
    if (!influencer_id || !d) return { error: "Influencer und Datum angeben" };
    const art = text(f, "art", 20) ?? "reel";
    if (!ARTEN.includes(art)) return { error: "Unbekannte Art" };
    const { error } = await sb.from("influencer_postings").insert({ influencer_id, datum: d, art, link: text(f, "link", 500), notiz: text(f, "notiz", 500) });
    if (error) return { error: error.message };
    revalidatePath("/marketing/aktionen");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Fehler" };
  }
}

export async function loeschePosting(id: string): Promise<Ergebnis> {
  try {
    const sb = await adminClient();
    const { error } = await sb.from("influencer_postings").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/marketing/aktionen");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Fehler" };
  }
}
