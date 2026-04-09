import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { signOut } from "@/lib/actions/auth";
import { LayoutDashboard, Package, LogOut } from "lucide-react";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();

  return (
    <div className="min-h-screen flex bg-neutral-50">
      <aside className="w-60 border-r border-neutral-200 bg-white flex flex-col">
        <div className="px-5 py-5 border-b border-neutral-200">
          <div className="text-base font-semibold text-neutral-900">Hairvenly</div>
          <div className="text-xs text-neutral-500">Lieferanten-Dashboard</div>
        </div>

        <nav className="flex-1 p-3 space-y-1 text-sm">
          <NavLink href="/" icon={<LayoutDashboard size={16} />} label="Übersicht" />
          <NavLink href="/orders" icon={<Package size={16} />} label="Bestellungen" />
        </nav>

        <div className="p-3 border-t border-neutral-200">
          <div className="px-2 py-2">
            <div className="text-xs text-neutral-500">Eingeloggt als</div>
            <div className="text-sm font-medium text-neutral-900 truncate">{profile.email}</div>
            <div className="text-xs text-neutral-500 mt-0.5">
              {profile.is_admin ? "Admin" : "Lieferant"}
            </div>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              className="w-full flex items-center gap-2 px-2 py-2 text-sm text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 rounded-lg transition"
            >
              <LogOut size={16} /> Abmelden
            </button>
          </form>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}

function NavLink({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 px-3 py-2 text-neutral-700 hover:bg-neutral-100 rounded-lg transition"
    >
      {icon}
      {label}
    </Link>
  );
}
