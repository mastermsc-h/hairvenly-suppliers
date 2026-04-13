import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { signOut } from "@/lib/actions/auth";
import { t, type Locale } from "@/lib/i18n";
import { LayoutDashboard, Package, Building2, Users, LogOut, FilePlus, Palette } from "lucide-react";
import LanguageSwitcher from "./language-switcher";
import { MobileSidebarWrapper } from "./mobile-sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const locale = (profile.language ?? "de") as Locale;

  const sidebarContent = (
    <>
      <div className="px-5 py-5 border-b border-neutral-200">
        <div className="text-base font-semibold text-neutral-900">Hairvenly</div>
        <div className="text-xs text-neutral-500">Lieferanten-Dashboard</div>
      </div>

      <nav className="flex-1 p-3 space-y-1 text-sm">
        <NavLink href="/" icon={<LayoutDashboard size={16} />} label={t(locale, "nav.overview")} />
        <NavLink href="/orders" icon={<Package size={16} />} label={t(locale, "nav.orders")} />
        {profile.is_admin && (
          <>
            <NavLink href="/admin/suppliers" icon={<Building2 size={16} />} label={t(locale, "nav.suppliers")} />
            <NavLink href="/admin/users" icon={<Users size={16} />} label={t(locale, "nav.users")} />

            <div className="border-t border-neutral-200 my-2" />
            <NavLink href="/orders/wizard" icon={<FilePlus size={16} />} label={t(locale, "nav.wizard")} />
            <NavLink href="/catalog" icon={<Palette size={16} />} label={t(locale, "nav.catalog")} />
          </>
        )}
      </nav>

      <div className="p-3 border-t border-neutral-200">
        <div className="px-2 py-2">
          <div className="flex items-center justify-between">
            <div className="text-xs text-neutral-500">{t(locale, "nav.logged_in_as")}</div>
            <LanguageSwitcher current={locale} />
          </div>
          <div className="text-sm font-medium text-neutral-900 truncate mt-1">
            {profile.display_name || profile.username || profile.email}
          </div>
          <div className="text-xs text-neutral-500 mt-0.5">
            {profile.is_admin ? t(locale, "nav.admin") : t(locale, "nav.supplier")}
          </div>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="w-full flex items-center gap-2 px-2 py-2 text-sm text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 rounded-lg transition"
          >
            <LogOut size={16} /> {t(locale, "nav.logout")}
          </button>
        </form>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex bg-neutral-50">
      {/* Desktop sidebar — hidden on mobile */}
      <aside className="hidden md:flex w-60 border-r border-neutral-200 bg-white flex-col shrink-0">
        {sidebarContent}
      </aside>

      {/* Mobile sidebar drawer + hamburger button */}
      <MobileSidebarWrapper sidebarContent={sidebarContent} />

      {/* Main content — add top padding on mobile for hamburger button */}
      <main className="flex-1 overflow-auto pt-14 md:pt-0">{children}</main>
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
