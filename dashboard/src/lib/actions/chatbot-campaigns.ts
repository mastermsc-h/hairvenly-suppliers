"use server";

import { requireAdmin } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

function str(fd: FormData, k: string): string {
  return String(fd.get(k) ?? "").trim();
}

/** Neue Aktion/Kampagne anlegen (z.B. Gewinnspiel). */
export async function createCampaign(fd: FormData) {
  const profile = await requireAdmin();
  const name = str(fd, "name");
  const starts_on = str(fd, "starts_on");
  if (!name || !starts_on) throw new Error("Name und Startdatum sind Pflicht.");
  const ends_on = str(fd, "ends_on") || null;
  const color = str(fd, "color") || "#ec4899";
  const note = str(fd, "note") || null;

  const svc = createServiceClient();
  const { error } = await svc.from("chatbot_campaigns").insert({
    name, starts_on, ends_on, color, note, created_by: profile.id,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/chatbot/stats");
}

/** Bestehende Aktion bearbeiten. */
export async function updateCampaign(fd: FormData) {
  await requireAdmin();
  const id = str(fd, "id");
  if (!id) throw new Error("id fehlt.");
  const name = str(fd, "name");
  const starts_on = str(fd, "starts_on");
  if (!name || !starts_on) throw new Error("Name und Startdatum sind Pflicht.");

  const svc = createServiceClient();
  const { error } = await svc
    .from("chatbot_campaigns")
    .update({
      name,
      starts_on,
      ends_on: str(fd, "ends_on") || null,
      color: str(fd, "color") || "#ec4899",
      note: str(fd, "note") || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/chatbot/stats");
}

/** Aktion löschen. */
export async function deleteCampaign(fd: FormData) {
  await requireAdmin();
  const id = str(fd, "id");
  if (!id) throw new Error("id fehlt.");
  const svc = createServiceClient();
  const { error } = await svc.from("chatbot_campaigns").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/chatbot/stats");
}
