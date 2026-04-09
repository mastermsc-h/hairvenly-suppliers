"use client";

import { useTransition } from "react";
import { updateLanguage } from "@/lib/actions/auth";
import type { Locale } from "@/lib/i18n";

const FLAGS: Record<Locale, string> = {
  de: "🇩🇪",
  en: "🇬🇧",
  tr: "🇹🇷",
};

export default function LanguageSwitcher({ current }: { current: Locale }) {
  const [pending, startTransition] = useTransition();

  function change(locale: Locale) {
    if (locale === current || pending) return;
    startTransition(async () => {
      await updateLanguage(locale);
    });
  }

  return (
    <div className="flex items-center gap-1">
      {(Object.keys(FLAGS) as Locale[]).map((loc) => (
        <button
          key={loc}
          onClick={() => change(loc)}
          disabled={pending}
          className={`text-base px-1 py-0.5 rounded transition ${
            loc === current
              ? "bg-neutral-100 ring-1 ring-neutral-300"
              : "opacity-40 hover:opacity-100"
          } ${pending ? "pointer-events-none" : ""}`}
          title={loc === "de" ? "Deutsch" : loc === "en" ? "English" : "Türkçe"}
        >
          {FLAGS[loc]}
        </button>
      ))}
    </div>
  );
}
