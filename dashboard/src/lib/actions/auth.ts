"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
export async function approveUser(userId: string, supplierId: string | null) {
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

  const { error } = await supabase
    .from("profiles")
    .update({ approved: true, supplier_id: supplierId })
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

  // Delete the auth user (cascades to profile)
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) return { error: error.message };

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

  const { error } = await supabase
    .from("profiles")
    .update({ username, display_name: displayName, language, supplier_id: supplierId })
    .eq("id", userId);
  if (error) return { error: error.message };

  revalidatePath("/admin/users");
  return { ok: true };
}
