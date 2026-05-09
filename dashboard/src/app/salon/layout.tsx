import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Hairvenly Salon",
  description: "Salon-Lager: Entnehmen & Zurueckgeben",
  // PWA-Hinweise: Vollbild auf iOS bei "Zum Home-Bildschirm hinzufuegen"
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Hairvenly Salon",
  },
  themeColor: "#0a0a0a",
};

export default function SalonLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-neutral-950 text-white flex flex-col select-none">
      {children}
    </div>
  );
}
