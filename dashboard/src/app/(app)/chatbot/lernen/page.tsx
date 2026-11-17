import { requireAdmin } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { GraduationCap, Moon } from "lucide-react";
import { agreementByCategory, AGREEING, type Verdict } from "@/lib/chatbot/learning-core";
import SuggestionCard, { type Suggestion } from "./suggestion-card";

export const dynamic = "force-dynamic";

const CATEGORY_LABEL: Record<string, string> = {
  availability: "Verfügbarkeit", general: "Allgemein", pricing: "Preise", color_advice: "Farbberatung",
  appointment: "Termine", order_status: "Bestellstatus", complaint: "Reklamation", gewerbe: "Gewerbe",
  models: "Modelle", partnership: "Kooperation",
};
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)} %` : "–");

export default async function LernenPage() {
  await requireAdmin();
  const svc = createServiceClient();
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();

  const [{ data: suggestions }, { data: compared }, { data: settings }, { count: waiting }] = await Promise.all([
    svc.from("chatbot_learning_suggestions")
      .select("id, kind, category, fact, bot_said, faq_question, faq_answer, team_reply_excerpt, created_at, session_id")
      .eq("status", "new")
      .order("created_at", { ascending: false })
      .limit(100),
    svc.from("chat_drafts")
      .select("comparison, offhours_candidate, session_id, chat_sessions(category)")
      .not("compared_at", "is", null)
      .gte("created_at", since)
      .limit(2000),
    svc.from("chatbot_settings").select("offhours_autosend").eq("id", 1).maybeSingle(),
    svc.from("chat_drafts").select("id", { count: "exact", head: true }).eq("status", "superseded").is("compared_at", null),
  ]);

  type Row = { comparison: { verdict: Verdict } | null; offhours_candidate: boolean; chat_sessions: { category: string | null } | { category: string | null }[] | null };
  const rows = ((compared ?? []) as unknown as Row[]).filter((r) => r.comparison?.verdict).map((r) => {
    const s = Array.isArray(r.chat_sessions) ? r.chat_sessions[0] : r.chat_sessions;
    return { category: s?.category ?? null, verdict: r.comparison!.verdict, offhours: r.offhours_candidate };
  });
  const agg = agreementByCategory(rows);
  const comparable = rows.filter((r) => r.verdict !== "not_comparable");
  const agreeing = comparable.filter((r) => AGREEING.includes(r.verdict)).length;
  const offh = rows.filter((r) => r.offhours && r.verdict !== "not_comparable");
  const offhAgree = offh.filter((r) => AGREEING.includes(r.verdict)).length;
  const offMode = (settings?.offhours_autosend as string) ?? "shadow";

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-5xl mx-auto">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <GraduationCap size={20} className="text-neutral-700" />
          <h1 className="text-xl font-semibold text-neutral-900">Bot lernt vom Team</h1>
        </div>
        <p className="text-sm text-neutral-500">
          Jede Nacht wird verglichen, was der Bot geantwortet <em>hätte</em> (Entwurf) und was ihr tatsächlich geschrieben habt.
          Wo ihr etwas wisst, das der Bot nicht weiß oder falsch sagt, entsteht unten ein Vorschlag. Übernehmen = ab sofort FAQ-Wissen des Bots.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
          <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Bot lag inhaltlich richtig</div>
          <div className="text-2xl font-bold text-neutral-900 mt-1">{pct(agreeing, comparable.length)}</div>
          <div className="text-xs text-neutral-400 mt-0.5">{agreeing} von {comparable.length} vergleichbaren Entwürfen (90 Tage)</div>
        </div>
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
          <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Offene Vorschläge</div>
          <div className="text-2xl font-bold text-neutral-900 mt-1">{suggestions?.length ?? 0}</div>
          <div className="text-xs text-neutral-400 mt-0.5">{waiting ? `${waiting} Entwürfe warten noch auf Vergleich` : "alle Entwürfe verglichen"}</div>
        </div>
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm col-span-2 md:col-span-1">
          <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-500 uppercase tracking-wide"><Moon size={12} /> Abend-/Wochenend-Bot</div>
          <div className="text-2xl font-bold text-neutral-900 mt-1">{offh.length ? pct(offhAgree, offh.length) : "–"}</div>
          <div className="text-xs text-neutral-400 mt-0.5">
            {offMode === "live" ? "Live" : offMode === "shadow" ? "Probelauf" : "Aus"} · {offh.length
              ? `${offhAgree} von ${offh.length} Antworten, die er außerhalb der Öffnungszeit geschickt hätte, deckten sich mit eurer`
              : "noch keine verglichenen Probelauf-Antworten"}
          </div>
        </div>
      </div>

      {agg.length > 0 && (
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-neutral-900 mb-3">Übereinstimmung je Thema</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-medium text-neutral-500 uppercase tracking-wide border-b border-neutral-100">
                <th className="text-left py-2">Thema</th>
                <th className="text-right py-2">verglichen</th>
                <th className="text-right py-2">richtig</th>
                <th className="text-right py-2">falsch</th>
                <th className="text-right py-2">Lücke</th>
              </tr>
            </thead>
            <tbody>
              {agg.map((a) => (
                <tr key={a.category} className="border-b border-neutral-50">
                  <td className="py-2 text-neutral-800">{CATEGORY_LABEL[a.category] ?? a.category}</td>
                  <td className="py-2 text-right text-neutral-600">{a.compared}</td>
                  <td className="py-2 text-right font-medium text-neutral-900">{pct(a.agreeing, a.compared)}</td>
                  <td className="py-2 text-right text-red-600">{a.wrong || ""}</td>
                  <td className="py-2 text-right text-amber-600">{a.missing || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-neutral-400 mt-2">„Lücke" = ihr habt etwas Wichtiges gesagt, das im Bot-Entwurf fehlte. Nicht vergleichbare Fälle (rein persönliche Antworten, Rückfragen) sind nicht mitgezählt.</p>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-900">Vorschläge zum Prüfen</h2>
        {(suggestions ?? []).length === 0 && (
          <p className="text-sm text-neutral-500">Keine offenen Vorschläge.</p>
        )}
        {((suggestions ?? []) as Suggestion[]).map((s) => <SuggestionCard key={s.id} s={s} />)}
      </div>
    </div>
  );
}
