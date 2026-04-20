"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export type LoginState = { error?: string } | undefined;
export type RegisterState = { error?: string; success?: boolean } | undefined;

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  let identifier = String(formData.get("identifier") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!identifier || !password) return { error: "Benutzername/E-Mail und Passwort sind erforderlich." };

  const supabase = await createClient();

  // If identifier doesn't look like an email, resolve username → email
  if (!identifier.includes("@")) {
    const { data } = await supabase.rpc("email_for_username", { uname: identifier });
    if (!data) return { error: "Benutzername nicht gefunden." };
    identifier = data;
  }

  const { error } = await supabase.auth.signInWithPassword({
    email: identifier,
    password,
  });
  if (error) return { error: "E-Mail/Benutzername oder Passwort falsch." };

  revalidatePath("/", "layout");
  redirect("/");
}

export async function register(
  _prev: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const username = String(formData.get("username") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const displayName = String(formData.get("display_name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  if (!username) return { error: "Benutzername ist erforderlich." };
  if (username.length < 3) return { error: "Benutzername muss mind. 3 Zeichen lang sein." };
  if (!/^[a-zA-Z0-9_.-]+$/.test(username))
    return { error: "Benutzername darf nur Buchstaben, Zahlen, Punkt, Bindestrich und Unterstrich enthalten." };
  if (!email) return { error: "E-Mail ist erforderlich." };
  if (!password) return { error: "Passwort ist erforderlich." };
  if (password.length < 6) return { error: "Passwort muss mind. 6 Zeichen lang sein." };
  if (password !== confirmPassword) return { error: "Passwörter stimmen nicht überein." };

  const supabase = await createClient();

  // Check if username is already taken
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .ilike("username", username)
    .maybeSingle();
  if (existing) return { error: "Benutzername ist bereits vergeben." };

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username, display_name: displayName || username },
    },
  });

  if (error) {
    if (error.message.includes("already registered")) {
      return { error: "Diese E-Mail ist bereits registriert." };
    }
    return { error: error.message };
  }

  revalidatePath("/", "layout");
  redirect("/pending");
}

export async function updateLanguage(language: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Nicht eingeloggt." };
  if (!["de", "en", "tr"].includes(language)) return { error: "Ungültige Sprache." };
  await supabase.from("profiles").update({ language }).eq("id", user.id);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

// Admin actions for user management
export async function approveUser(
  userId: string,
  supplierId: string | null,
  role: string = "supplier",
  deniedFeatures: string[] = [],
) {
  const supabase = await createClient();

  // Verify caller is admin
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Nicht eingeloggt." };
  const { data: caller } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!caller?.is_admin) return { error: "Nur Admins können Benutzer freigeben." };

  const isAdmin = role === "admin";
  const { error } = await supabase
    .from("profiles")
    .update({
      approved: true,
      supplier_id: supplierId,
      role,
      is_admin: isAdmin || role === "employee",
      denied_features: deniedFeatures,
    })
    .eq("id", userId);
  if (error) return { error: error.message };

  revalidatePath("/admin/users");
  return { ok: true };
}

export async function rejectUser(userId: string) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Nicht eingeloggt." };
  const { data: caller } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!caller?.is_admin) return { error: "Nur Admins." };

  // Delete the auth user (cascades to profile) — needs service role
  const admin = createServiceClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return { error: error.message };

  revalidatePath("/admin/users");
  return { ok: true };
}

export async function createUser(formData: FormData) {
  const supabase = await createClient();

  // Verify caller is admin
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Nicht eingeloggt." };
  const { data: caller } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!caller?.is_admin) return { error: "Nur Admins können Benutzer anlegen." };

  const username = String(formData.get("username") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const displayName = String(formData.get("display_name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "employee").trim();
  const supplierId = String(formData.get("supplier_id") ?? "").trim() || null;
  const deniedFeaturesRaw = String(formData.get("denied_features") ?? "").trim();
  const deniedFeatures = deniedFeaturesRaw ? deniedFeaturesRaw.split(",").filter(Boolean) : [];

  if (!username || username.length < 3) return { error: "Benutzername muss mind. 3 Zeichen lang sein." };
  if (!/^[a-zA-Z0-9_.-]+$/.test(username))
    return { error: "Benutzername darf nur Buchstaben, Zahlen, Punkt, Bindestrich und Unterstrich enthalten." };
  if (!email) return { error: "E-Mail ist erforderlich." };
  if (!password || password.length < 6) return { error: "Passwort muss mind. 6 Zeichen lang sein." };

  // Check username uniqueness
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .ilike("username", username)
    .maybeSingle();
  if (existing) return { error: "Benutzername ist bereits vergeben." };

  // Create auth user (auto-confirmed, no email verification) — needs service role
  const admin = createServiceClient();
  const { data: newUser, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username, display_name: displayName || username },
  });
  if (createError) {
    if (createError.message.includes("already been registered"))
      return { error: "Diese E-Mail ist bereits registriert." };
    return { error: createError.message };
  }

  // Update profile with role, approval, etc. — use service client (RLS bypass)
  const { error: updateError } = await admin
    .from("profiles")
    .update({
      username,
      display_name: displayName || username,
      approved: true,
      role,
      is_admin: role === "admin" || role === "employee",
      supplier_id: role === "supplier" ? supplierId : null,
      denied_features: role === "employee" ? deniedFeatures : [],
    })
    .eq("id", newUser.user.id);
  if (updateError) return { error: updateError.message };

  revalidatePath("/admin/users");
  return { ok: true };
}

export async function updateUser(userId: string, formData: FormData) {
  const supabase = await createClient();

  // Verify caller is admin
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Nicht eingeloggt." };
  const { data: caller } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!caller?.is_admin) return { error: "Nur Admins können Benutzer bearbeiten." };

  const username = String(formData.get("username") ?? "").trim() || null;
  const displayName = String(formData.get("display_name") ?? "").trim() || null;
  const language = String(formData.get("language") ?? "de").trim();
  const supplierId = String(formData.get("supplier_id") ?? "").trim() || null;
  const role = String(formData.get("role") ?? "").trim() || undefined;
  const deniedFeaturesRaw = String(formData.get("denied_features") ?? "").trim();
  const deniedFeatures = deniedFeaturesRaw ? deniedFeaturesRaw.split(",").filter(Boolean) : [];

  const updates: Record<string, unknown> = {
    username,
    display_name: displayName,
    language,
    supplier_id: supplierId,
  };
  if (role) {
    updates.role = role;
    updates.is_admin = role === "admin" || role === "employee";
    updates.denied_features = deniedFeatures;
  }

  const { error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", userId);
  if (error) return { error: error.message };

  revalidatePath("/admin/users");
  return { ok: true };
}

export async function resetPassword(userId: string, newPassword: string) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Nicht eingeloggt." };
  const { data: caller } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!caller?.is_admin) return { error: "Nur Admins." };

  if (!newPassword || newPassword.length < 6) return { error: "Passwort muss mind. 6 Zeichen lang sein." };

  const admin = createServiceClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
  if (error) return { error: error.message };

  return { ok: true };
}
