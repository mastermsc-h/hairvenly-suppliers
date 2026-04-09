"use client";

import { useRouter } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";

export default function BackLink({ locale = "de" }: { locale?: Locale }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push("/");
      }}
      className="text-sm text-neutral-500 hover:text-neutral-900"
    >
      ← {t(locale, "common.back")}
    </button>
  );
}
