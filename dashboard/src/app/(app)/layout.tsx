import Link from "next/link";
import { requireProfile, hasFeature } from "@/lib/auth";
import { signOut } from "@/lib/actions/auth";
import { t, type Locale } from "@/lib/i18n";
import type { FeatureKey } from "@/lib/types";
import { LayoutDashboard, Package, Building2, Users, LogOut, FilePlus, Palette, Warehouse, DollarSign, Landmark, RotateCcw, FileText, Settings, Truck, Globe2 } from "lucide-react";
import SidebarGroup from "./sidebar-group";
import LanguageSwitcher from "./language-switcher";
import { MobileSidebarWrapper } from "./mobile-sidebar";
import ChangePassword from "./change-password";
import TopProgress from "./top-progress";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const locale = (profile.language ?? "de") as Locale;

  const has = (f: FeatureKey) => hasFeature(profile, f);

  const sidebarContent = (
    <>
      <div className="px-5 py-5 border-b border-neutral-200">
        <div className="text-base font-semibold text-neutral-900">Hairvenly</div>
        <div className="text-xs text-neutral-500">Lieferanten-Dashboard</div>
      </div>

      <nav className="p-3 space-y-1 text-sm">
        {/* 1) Auslandsbestellungen + Neue Bestellung */}
        <NavLink href="/" icon={<Globe2 size={16} />} label={t(locale, "nav.overview")} />
        {profile.role === "supplier" && (
          <NavLink href="/orders" icon={<Package size={16} />} label={t(locale, "nav.orders")} />
        )}
        {profile.role !== "supplier" && (
          <>
            {has("wizard") && <NavLink href="/orders/wizard" icon={<FilePlus size={16} />} label={t(locale, "nav.wizard")} />}

            {/* 2) Produktlager · Preistabellen · Farbcodes */}
            {(has("stock") || has("prices") || has("catalog")) && (
              <div className="border-t border-neutral-200 my-2" />
            )}
            {has("stock") && (
              <SidebarGroup
                label={t(locale, "nav.stock")}
                icon={<Warehouse size={16} />}
                href="/stock"
                items={[
                  { href: "/stock", label: "Übersicht", exact: true },
                  { href: "/stock/uzbek", label: t(locale, "nav.stock.uzbek") },
                  { href: "/stock/russian", label: t(locale, "nav.stock.russian") },
                  {
                    href: "/stock/topseller",
                    label: t(locale, "nav.stock.topseller"),
                    children: [
                      { href: "/stock/topseller/uzbek", label: t(locale, "nav.stock.uzbek") },
                      { href: "/stock/topseller/russian", label: t(locale, "nav.stock.russian") },
                    ],
                  },
                  {
                    href: "/stock/zero",
                    label: t(locale, "nav.stock.zero"),
                    children: [
                      { href: "/stock/zero/uzbek", label: t(locale, "nav.stock.uzbek") },
                      { href: "/stock/zero/russian", label: t(locale, "nav.stock.russian") },
                    ],
                  },
                  {
                    href: "/stock/critical",
                    label: t(locale, "nav.stock.critical"),
                    children: [
                      { href: "/stock/critical/uzbek", label: t(locale, "nav.stock.uzbek") },
                      { href: "/stock/critical/russian", label: t(locale, "nav.stock.russian") },
                    ],
                  },
                  {
                    href: "/stock/transit",
                    label: t(locale, "nav.stock.transit"),
                    children: [
                      { href: "/stock/transit/uzbek", label: t(locale, "nav.stock.uzbek") },
                      { href: "/stock/transit/russian", label: t(locale, "nav.stock.russian") },
                    ],
                  },
                  { href: "/stock/sales", label: t(locale, "nav.stock.sales") },
                  { href: "/stock/preorders", label: t(locale, "nav.stock.preorders") },
                ]}
              />
            )}
            {has("prices") && <NavLink href="/prices" icon={<DollarSign size={16} />} label={t(locale, "nav.prices")} />}
            {has("catalog") && <NavLink href="/catalog" icon={<Palette size={16} />} label={t(locale, "nav.catalog")} />}

            {/* 3) Zoll Schweiz */}
            {has("customs_ch") && (
              <>
                <div className="border-t border-neutral-200 my-2" />
                <NavLink
                  href="/customs-ch"
                  icon={<FileText size={16} />}
                  label={t(locale, "nav.customs_ch")}
                />
              </>
            )}

            {/* 4) Retouren · Versand */}
            {(has("returns") || has("shipping")) && (
              <div className="border-t border-neutral-200 my-2" />
            )}
            {has("returns") && (
              <SidebarGroup
                label={t(locale, "nav.returns")}
                icon={<RotateCcw size={16} />}
                href="/returns"
                items={[
                  { href: "/returns", label: t(locale, "nav.returns.list") },
                  { href: "/returns/analytics", label: t(locale, "nav.returns.analytics") },
                ]}
              />
            )}
            {has("shipping") && (
              <SidebarGroup
                label={t(locale, "nav.shipping")}
                icon={<Truck size={16} />}
                href="/pack"
                items={[
                  { href: "/pack", label: t(locale, "nav.shipping.list") },
                  { href: "/pack/archive", label: t(locale, "nav.shipping.archive") },
                  { href: "/pack/stats", label: t(locale, "nav.shipping.stats") },
                  { href: "/pack/display", label: t(locale, "nav.shipping.display") },
                ]}
              />
            )}

            {/* Finanzen — bleibt erreichbar, aber gruppiert ans Ende vor den Bold-Separator */}
            {has("finances") && (
              <>
                <div className="border-t border-neutral-200 my-2" />
                <SidebarGroup
                  label={t(locale, "nav.finances")}
                  icon={<Landmark size={16} />}
                  href="/finances"
                  items={[
                    { href: "/finances/overview", label: t(locale, "nav.finances.overview") },
                    { href: "/finances/bwa", label: t(locale, "nav.finances.bwa") },
                    { href: "/finances/prepayments", label: t(locale, "nav.finances.prepayments") },
                    { href: "/finances/transfers", label: t(locale, "nav.finances.transfers") },
                  ]}
                />
              </>
            )}

            {/* 5) Bold-Separator + Einstellungen */}
            {(has("suppliers") || has("users")) && (
              <>
                <div className="border-t-2 border-neutral-300 my-3" />
                <SidebarGroup
                  label={t(locale, "nav.settings")}
                  icon={<Settings size={16} />}
                  items={[
                    ...(has("suppliers") ? [{ href: "/admin/suppliers", label: t(locale, "nav.suppliers") }] : []),
                    ...(has("users") ? [{ href: "/admin/users", label: t(locale, "nav.users") }] : []),
                  ]}
                />
              </>
            )}
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
            {t(locale, `role.${profile.role}`)}
          </div>
        </div>
        <ChangePassword label={t(locale, "nav.change_password")} />
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
      <TopProgress />
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
