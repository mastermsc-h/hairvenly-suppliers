import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import type { Supplier } from "@/lib/types";
import UserRow from "./user-row";

export default async function UsersPage() {
  const profile = await requireProfile();
  if (!profile.is_admin) redirect("/");

  const supabase = await createClient();
  const [{ data: profiles }, { data: suppliers }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, username, display_name, is_admin, approved, supplier_id, language, created_at")
      .order("created_at", { ascending: false }),
    supabase.from("suppliers").select("*").order("sort_order").order("name"),
  ]);

  const allProfiles = (profiles ?? []) as {
    id: string;
    email: string;
    username: string | null;
    display_name: string | null;
    is_admin: boolean;
    approved: boolean;
    supplier_id: string | null;
    language: string;
    created_at: string;
  }[];
  const allSuppliers = (suppliers ?? []) as Supplier[];

  const pending = allProfiles.filter((p) => !p.approved && !p.is_admin);
  const active = allProfiles.filter((p) => p.approved || p.is_admin);

  return (
    <div className="p-8 max-w-4xl space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">Benutzerverwaltung</h1>
        <p className="text-sm text-neutral-500 mt-1">Benutzer freigeben, Lieferanten zuweisen</p>
      </header>

      {/* Pending users */}
      {pending.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-neutral-900 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            Warten auf Freigabe ({pending.length})
          </h2>
          <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden shadow-sm divide-y divide-neutral-100">
            {pending.map((p) => (
              <UserRow key={p.id} profile={p} suppliers={allSuppliers} isPending />
            ))}
          </div>
        </section>
      )}

      {/* Active users */}
      <section>
        <h2 className="text-lg font-semibold text-neutral-900 mb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          Aktive Benutzer ({active.length})
        </h2>
        <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden shadow-sm divide-y divide-neutral-100">
          {active.map((p) => (
            <UserRow key={p.id} profile={p} suppliers={allSuppliers} isPending={false} />
          ))}
        </div>
      </section>
    </div>
  );
}
