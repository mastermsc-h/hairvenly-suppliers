import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import type { Supplier } from "@/lib/types";
import SupplierRow from "./supplier-row";
import NewSupplierForm from "./new-supplier-form";

export default async function SuppliersPage() {
  const profile = await requireAdmin();

  const supabase = await createClient();
  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("*")
    .order("sort_order")
    .order("name");

  const allSuppliers = (suppliers ?? []) as Supplier[];

  return (
    <div className="p-8 max-w-4xl space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">Lieferantenverwaltung</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Lieferanten anlegen, bearbeiten und entfernen
        </p>
      </header>

      <NewSupplierForm />

      <section>
        <h2 className="text-lg font-semibold text-neutral-900 mb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-indigo-500" />
          Lieferanten ({allSuppliers.length})
        </h2>
        <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden shadow-sm divide-y divide-neutral-100">
          {allSuppliers.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-neutral-400">
              Noch keine Lieferanten vorhanden.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-neutral-50 text-left text-xs text-neutral-500 uppercase tracking-wider">
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">E-Mail</th>
                  <th className="px-5 py-3 font-medium">Telefon</th>
                  <th className="px-5 py-3 font-medium text-center">Reihenfolge</th>
                  <th className="px-5 py-3 font-medium">Erstellt</th>
                  <th className="px-5 py-3 font-medium text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {allSuppliers.map((supplier) => (
                  <SupplierRow key={supplier.id} supplier={supplier} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
