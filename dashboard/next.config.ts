import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  // Zahlungseingänge von Finanzen nach "Shopify Bestellungen" verschoben
  // (19.11.2026). Alte Links/Bookmarks/Cron-Mails weiterleiten.
  async redirects() {
    return [
      { source: "/finances/payments", destination: "/pack/zahlungen", permanent: true },
    ];
  },
};

export default nextConfig;
