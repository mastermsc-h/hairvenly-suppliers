import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile, FeatureKey } from "@/lib/types";

/** Returns the current user's profile, redirecting to /login if not signed in. */
export async function requireProfile(): Promise<Profile> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, username, display_name, is_admin, approved, language, supplier_id, role, denied_features")
    .eq("id", user.id)
    .single();

  if (!profile) {
    // Profile row should be auto-created via trigger. If missing, sign out.
    await supabase.auth.signOut();
    redirect("/login");
  }

  // Redirect unapproved, non-admin users to pending page
  if (!profile.approved && !profile.is_admin) {
    redirect("/pending");
  }

  return profile as Profile;
}

export async function requireAdmin(): Promise<Profile> {
  const profile = await requireProfile();
  if (!profile.is_admin) redirect("/");
  return profile;
}

/** Check if a profile has access to a given feature. Admins always have access. */
export function hasFeature(profile: Profile, feature: FeatureKey): boolean {
  if (profile.role === "admin") return true;
  if (profile.role === "supplier") return false;
  // Employee: check denied_features
  return !profile.denied_features.includes(feature);
}

/** Server-side guard: redirect to / if the user doesn't have access to the feature. */
export async function requireFeature(feature: FeatureKey): Promise<Profile> {
  const profile = await requireProfile();
  if (!hasFeature(profile, feature)) redirect("/");
  return profile;
}
