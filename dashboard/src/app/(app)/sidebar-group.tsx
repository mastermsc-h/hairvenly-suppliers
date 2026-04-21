"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";

export interface SidebarItem {
  href: string;
  label: string;
  children?: { href: string; label: string }[];
}

interface SidebarGroupProps {
  label: string;
  icon: React.ReactNode;
  href?: string;
  items: SidebarItem[];
}

export default function SidebarGroup({ label, icon, href, items }: SidebarGroupProps) {
  const pathname = usePathname();
  const isExactMatch = href && pathname === href;
  const allHrefs = items.flatMap((i) => [i.href, ...(i.children?.map((c) => c.href) ?? [])]);
  const isActive = isExactMatch || allHrefs.some((h) => pathname === h || pathname.startsWith(h + "/"));
  const [open, setOpen] = useState(isActive);

  return (
    <div>
      <div className="flex items-center">
        {href ? (
          <Link
            href={href}
            onClick={() => setOpen(true)}
            className={`flex-1 flex items-center gap-2 px-3 py-2 text-neutral-700 hover:bg-neutral-100 rounded-lg transition ${
              isExactMatch ? "bg-neutral-100 font-medium" : ""
            }`}
          >
            {icon}
            <span>{label}</span>
          </Link>
        ) : (
          <span className="flex-1 flex items-center gap-2 px-3 py-2 text-neutral-700">{icon}<span>{label}</span></span>
        )}
        <button
          onClick={() => setOpen(!open)}
          className="p-2 text-neutral-400 hover:text-neutral-700 rounded-lg hover:bg-neutral-100 transition"
        >
          <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      {open && (
        <div className="ml-5 mt-0.5 space-y-0.5 border-l border-neutral-200 pl-2">
          {items.map((item) =>
            item.children ? (
              <SubGroup key={item.href} item={item} pathname={pathname} />
            ) : (
              <NavItem key={item.href} href={item.href} label={item.label} pathname={pathname} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function NavItem({ href, label, pathname }: { href: string; label: string; pathname: string }) {
  const isActive = pathname === href || pathname.startsWith(href + "/");
  return (
    <Link
      href={href}
      className={`block px-3 py-1.5 text-sm rounded-md transition ${
        isActive
          ? "bg-neutral-100 text-neutral-900 font-medium"
          : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50"
      }`}
    >
      {label}
    </Link>
  );
}

function SubGroup({ item, pathname }: { item: SidebarItem; pathname: string }) {
  const childHrefs = item.children?.map((c) => c.href) ?? [];
  const isChildActive = childHrefs.some((h) => pathname === h || pathname.startsWith(h + "/"));
  const isSelfActive = pathname === item.href;
  const isAnyActive = isSelfActive || isChildActive;
  const [open, setOpen] = useState(isAnyActive);

  return (
    <div>
      <div className="flex items-center">
        <Link
          href={item.href}
          onClick={() => setOpen(true)}
          className={`flex-1 px-3 py-1.5 text-sm rounded-md transition ${
            isSelfActive
              ? "bg-neutral-100 text-neutral-900 font-medium"
              : isChildActive
                ? "text-neutral-900 font-medium"
                : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50"
          }`}
        >
          {item.label}
        </Link>
        <button
          onClick={() => setOpen(!open)}
          className="p-1 text-neutral-400 hover:text-neutral-700 rounded transition"
        >
          <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      {open && item.children && (
        <div className="ml-3 mt-0.5 space-y-0.5 border-l border-neutral-100 pl-2">
          {item.children.map((child) => (
            <NavItem key={child.href} href={child.href} label={child.label} pathname={pathname} />
          ))}
        </div>
      )}
    </div>
  );
}
