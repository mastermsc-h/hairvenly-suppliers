"use client";

import { useState, useEffect } from "react";
import { Menu, X } from "lucide-react";

export function MobileMenuButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="md:hidden fixed top-3 left-3 z-40 w-10 h-10 rounded-xl bg-white border border-neutral-200 shadow-sm flex items-center justify-center text-neutral-700 hover:bg-neutral-50 active:bg-neutral-100 transition"
      aria-label="Menu"
    >
      <Menu size={20} />
    </button>
  );
}

export function MobileDrawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="absolute left-0 top-0 bottom-0 w-64 bg-white shadow-xl flex flex-col animate-in slide-in-from-left duration-200">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-lg flex items-center justify-center text-neutral-500 hover:bg-neutral-100 bg-white/80 backdrop-blur"
          aria-label="Close"
        >
          <X size={18} />
        </button>
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </aside>
    </div>
  );
}

export function MobileSidebarWrapper({ sidebarContent }: { sidebarContent: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <MobileMenuButton onClick={() => setOpen(true)} />
      <MobileDrawer open={open} onClose={() => setOpen(false)}>
        <div onClick={() => setOpen(false)}>{sidebarContent}</div>
      </MobileDrawer>
    </>
  );
}
