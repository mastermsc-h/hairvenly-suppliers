import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/** Returns the current user's profile, redirecting to /login if not signed in. */
export async function requireProfile(): Promise<Profile> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, is_admin, supplier_id")
    .eq("id", user.id)
    .single();

  if (!profile) {
    // Profile row should be auto-created via trigger. If missing, sign out.
    await supabase.auth.signOut();
    redirect("/login");
  }
  return profile as Profile;
}

export async function requireAdmin(): Promise<Profile> {
  const profile = await requireProfile();
  if (!profile.is_admin) redirect("/");
  return profile;
}
