import { requireProfile } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import KillSwitchPanel from "./kill-switch-panel";

export const dynamic = "force-dynamic";

const ALL_CATEGORIES: { key: string; label: string; emoji: string; risky: boolean }[] = [
  { key: "availability", label: "Verfügbarkeit", emoji: "📦", risky: false },
  { key: "pricing",      label: "Preis",         emoji: "💰", risky: false },
  { key: "general",      label: "Sonstiges",     emoji: "💬", risky: false },
  { key: "appointment",  label: "Termin",        emoji: "📅", risky: true  },
  { key: "color_advice", label: "Farbberatung",  emoji: "🎨", risky: true  },
  { key: "complaint",    label: "Reklamation",   emoji: "⚠️",  risky: true  },
  { key: "order_status", label: "Bestellstatus", emoji: "🚚", risky: true  },
  { key: "gewerbe",      label: "Gewerbe",       emoji: "💼", risky: true  },
  { key: "partnership",  label: "Partnership",   emoji: "🤝", risky: true  },
  { key: "models",       label: "Modelle",       emoji: "📸", risky: true  },
];

export default async function BotSettingsPage() {
  const profile = await requireProfile();
  if (!profile.is_admin) {
    return <div className="p-8 text-neutral-500">Nur für Admins.</div>;
  }
  const svc = createServiceClient();
  const { data } = await svc
    .from("chatbot_settings")
    .select(
      "default_bot_mode, proactive_generation_enabled, proactive_safe_categories, updated_at"
    )
    .eq("id", 1)
    .maybeSingle();
  const settings = data || {
    default_bot_mode: "selective_auto",
    proactive_generation_enabled: false,
    proactive_safe_categories: [],
    updated_at: null,
  };
  const safe = (settings.proactive_safe_categories || []) as string[];

  const noneAllowed =
    !settings.proactive_generation_enabled && safe.length === 0;

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900">
          Bot-Einstellungen
        </h1>
        <p className="text-sm text-neutral-600 mt-0.5">
          Globaler Kill-Switch für proaktive Bot-Antworten + Whitelist der
          Kategorien, in denen der Bot trotzdem automatisch antworten darf.
        </p>
      </div>

      {/* Warnung wenn die Kombination "kein Auto-Bot überhaupt" ergibt */}
      {noneAllowed && (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
          <div className="text-sm font-semibold text-amber-900">
            ⚠️ Aktuell antwortet der Bot AUF KEINE Kundenanfrage automatisch
          </div>
          <div className="text-xs text-amber-800 mt-1 leading-relaxed">
            Der Kill-Switch ist aktiv (gesperrt) UND die Whitelist ist leer.
            Jede neue Customer-Message landet still in der Inbox, ohne dass
            der Bot reagiert. Wenn du das nicht willst, entweder den Kill-
            Switch deaktivieren oder mindestens eine sichere Kategorie
            (z.B. <code>availability</code>) in die Whitelist aufnehmen.
          </div>
        </div>
      )}

      <KillSwitchPanel
        initialEnabled={settings.proactive_generation_enabled ?? false}
        initialSafe={safe}
        categories={ALL_CATEGORIES}
      />

      {settings.updated_at && (
        <div className="text-xs text-neutral-500 text-right">
          Zuletzt geändert:{" "}
          {new Date(settings.updated_at).toLocaleString("de-DE", {
            day: "2-digit",
            month: "2-digit",
            year: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      )}
    </div>
  );
}
