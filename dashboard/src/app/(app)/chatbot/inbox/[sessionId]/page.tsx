import { requireProfile } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import ChatSessionView from "./session-view";

interface PageProps {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ back?: string }>;
}

export const dynamic = "force-dynamic";

export default async function ChatSessionPage({ params, searchParams }: PageProps) {
  await requireProfile();
  const { sessionId } = await params;
  const sp = await searchParams;
  // back-Query (URL-encoded): wird vom Inbox-Listing mitgegeben und enthält
  // view/mode/filter/sort/unread_only/limit, damit der "Zurück"-Link den
  // exakten Inbox-Zustand wiederherstellt.
  const backRaw = (sp.back || "").trim();
  // Defensive: keine fremden URLs zulassen — nur Query-Param-Form akzeptieren.
  // Plus #session-<id>-Hash, damit die Inbox direkt zur Karte zurückspringt,
  // die vorher angeklickt wurde (User-Wunsch 2026-05-28: nicht jedes Mal nach
  // unten scrollen müssen).
  const backInboxBase = /^[A-Za-z0-9_\-=&%.+]*$/.test(backRaw) && backRaw.length > 0
    ? `/chatbot/inbox?${backRaw}`
    : "/chatbot/inbox";
  const backInboxHref = `${backInboxBase}#session-${sessionId}`;

  const svc = createServiceClient();
  const { data: session } = await svc
    .from("chat_sessions")
    .select(`
      id, channel, customer_name, customer_full_name, status, assigned_to, bot_signature_name,
      bot_auto_reply, bot_mode, human_only, team_notes, team_notes_updated_at, team_notes_updated_by,
      followup_due_at, followup_reason, external_id, category, additional_categories,
      last_message_at, created_at,
      assigned_profile:profiles!chat_sessions_assigned_to_fkey(display_name,email),
      team_notes_profile:profiles!chat_sessions_team_notes_updated_by_fkey(display_name,email)
    `)
    .eq("id", sessionId)
    .single();

  if (!session) notFound();

  // INSTAGRAM-STYLE "gelesen"-Indikator: last_opened_by_agent_at wird
  // beim Öffnen aktualisiert. ARCHITEKTUR-WECHSEL 2026-05-29: das passiert
  // jetzt CLIENT-seitig in session-view.tsx via useEffect on mount, NICHT
  // mehr hier als SSR-Side-Effect.
  //
  // Grund: SSR-Side-Effect feuerte bei JEDEM Render — also auch bei
  // router.refresh() innerhalb der Page. Das hat den "Ungelesen"-Sentinel
  // sofort wieder zerstört. Mit Sentinel-Schutz blieb er dafür sticky bei
  // erneutem Öffnen aus der Inbox. Beides falsch.
  //
  // Mount-basiert ist semantisch korrekt: nur eine ECHTE Navigation
  // (Component-Mount) zählt als "geöffnet". router.refresh() ändert die
  // URL nicht und unmountet nicht → Sentinel bleibt erhalten.

  // Aktive Avatars für Selector
  const { data: avatars } = await svc
    .from("chatbot_avatars")
    .select("name")
    .eq("active", true)
    .order("name");

  // Pending Draft (falls Bot-Begleitung Modus)
  const { data: pendingDraftRaw } = await svc
    .from("chat_drafts")
    .select("id, original_text, created_at")
    .eq("session_id", sessionId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 🛡 STALE-DRAFT-INVARIANTE (Bug 01.06, Zélia): Ein Entwurf wird für einen
  // bestimmten Gesprächsstand erzeugt. Schreibt die Kundin DANACH neue
  // Nachrichten (z.B. "Danke" + Foto + neue Frage), bezieht sich der alte
  // Entwurf auf einen Stand, den es nicht mehr gibt — und steht in der UI
  // direkt unter der neuen Kundennachricht, als hätte der Bot gerade darauf
  // geantwortet. REGEL: Ein Entwurf, der ÄLTER ist als die letzte
  // Kundennachricht, ist veraltet → nicht anzeigen. Deckt ALLE stale-Drafts
  // strukturell ab (keine Einzelfall-Behandlung).
  let pendingDraft = pendingDraftRaw;
  if (pendingDraftRaw) {
    const { data: lastUserMsg } = await svc
      .from("chat_messages")
      .select("created_at")
      .eq("session_id", sessionId)
      .eq("role", "user")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastUserMsg?.created_at && lastUserMsg.created_at > pendingDraftRaw.created_at) {
      // Entwurf ist älter als die letzte Kundennachricht → veraltet.
      // Soft-verwerfen, damit er nicht erneut auftaucht, und NICHT anzeigen.
      await svc.from("chat_drafts")
        .update({ status: "discarded" })
        .eq("id", pendingDraftRaw.id);
      console.log(`[inbox] stale draft ${pendingDraftRaw.id} discarded (draft ${pendingDraftRaw.created_at} < lastUser ${lastUserMsg.created_at}) session=${sessionId.slice(0,8)}`);
      pendingDraft = null;
    }
  }

  // Aktive Wartelisten-Reservierungen für diese Session — als Banner in der
  // Session-View anzeigen, damit die MA sieht "die Kundin ist auf der Liste
  // für X" und ggf. direkt stornieren kann (User-Wunsch 2026-05-28).
  const { data: activeReservations } = await svc
    .from("chat_reservations")
    .select("id, product_name, product_url, color, method, eta_hint, notes, requested_at, status")
    .eq("session_id", sessionId)
    .eq("status", "waiting")
    .order("requested_at", { ascending: false });

  const { data: messages } = await svc
    .from("chat_messages")
    .select(`
      id, role, content, attachments, tool_calls, agent_id, auto_sent, teach_feedback_at, teach_sentiment, external_id, reply_to_external_id, created_at,
      agent:profiles!chat_messages_agent_id_fkey(display_name,email)
    `)
    .eq("session_id", sessionId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-4">
      <Link
        href={backInboxHref}
        className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900"
      >
        <ArrowLeft size={14} />
        Zurück zur Inbox
      </Link>

      <ChatSessionView
        session={{
          id: session.id,
          channel: session.channel,
          status: session.status,
          assigned_to: session.assigned_to,
          bot_signature_name: session.bot_signature_name,
          customer_name: session.customer_name,
          customer_full_name: (session as { customer_full_name?: string | null }).customer_full_name ?? null,
          human_only: (session as { human_only?: boolean }).human_only ?? false,
          team_notes: (session as { team_notes?: string | null }).team_notes ?? null,
          team_notes_updated_at: (session as { team_notes_updated_at?: string | null }).team_notes_updated_at ?? null,
          team_notes_author: (() => {
            const p = (session as { team_notes_profile?: { display_name?: string; email?: string } | null }).team_notes_profile;
            return p?.display_name || p?.email || null;
          })(),
          followup_due_at: (session as { followup_due_at?: string | null }).followup_due_at ?? null,
          followup_reason: (session as { followup_reason?: string | null }).followup_reason ?? null,
          bot_auto_reply: session.bot_auto_reply ?? false,
          bot_mode: (session.bot_mode ?? (session.bot_auto_reply ? "auto" : "off")) as "auto" | "selective_auto" | "assisted" | "off",
          category: session.category as null | "availability" | "pricing" | "color_advice" | "appointment" | "complaint" | "order_status" | "gewerbe" | "partnership" | "models" | "general",
          additional_categories: (((session as { additional_categories?: string[] | null }).additional_categories) || []) as Array<"availability" | "pricing" | "color_advice" | "appointment" | "complaint" | "order_status" | "gewerbe" | "partnership" | "models" | "general">,
          assigned_name: (() => {
            const p = session.assigned_profile as unknown as { display_name?: string; email?: string } | null;
            return p?.display_name || p?.email || null;
          })(),
        }}
        avatarOptions={(avatars || []).map(a => a.name)}
        pendingDraft={pendingDraft ? {
          id: pendingDraft.id,
          original_text: pendingDraft.original_text,
          created_at: pendingDraft.created_at,
        } : null}
        activeReservations={(activeReservations || []).map(r => ({
          id: r.id,
          product_name: r.product_name,
          product_url: r.product_url ?? null,
          color: r.color ?? null,
          method: r.method ?? null,
          eta_hint: r.eta_hint ?? null,
          notes: r.notes ?? null,
          requested_at: r.requested_at ?? null,
        }))}
        initialMessages={(() => {
          const msgs = messages ?? [];
          // Lookup-Map external_id → { id, role, content } für Reply-Threading.
          // Die id brauchen wir, damit die UI per Klick zur referenzierten
          // Original-Message scrollen kann (wie Instagram).
          const byExt = new Map<string, { id: string; role: string; content: string | null }>();
          for (const m of msgs) {
            const ext = (m as { external_id?: string | null }).external_id;
            if (ext) byExt.set(ext, { id: m.id, role: m.role, content: m.content });
          }
          return msgs.map(m => {
            const replyToExt = (m as { reply_to_external_id?: string | null }).reply_to_external_id;
            const repliedTo = replyToExt ? byExt.get(replyToExt) : null;
            // Wenn die Reply-Referenz da ist, aber das Original nicht in unserer
            // DB ist (zu alt, Story-Reply, vor Webhook-Onboarding), trotzdem
            // einen "external"-Hinweis-Snippet zeigen — sonst weiß die
            // Mitarbeiterin gar nicht dass es eine Reply war.
            let replyTo: { id: string | null; role: string; content_preview: string } | null = null;
            if (repliedTo) {
              replyTo = {
                id: repliedTo.id,
                role: repliedTo.role,
                content_preview: (repliedTo.content || "").slice(0, 140),
              };
            } else if (replyToExt) {
              replyTo = { id: null, role: "external", content_preview: "" };
            }
            return {
              id: m.id,
              role: m.role,
              content: m.content,
              attachments: (m.attachments as { type: string; url: string }[] | null) || [],
              tool_calls: m.tool_calls as { name: string }[] | null,
              agent_name: (() => {
                const p = m.agent as unknown as { display_name?: string; email?: string } | null;
                return p?.display_name || p?.email || null;
              })(),
              auto_sent: (m as { auto_sent?: boolean }).auto_sent ?? false,
              teach_feedback_at: (m as { teach_feedback_at?: string | null }).teach_feedback_at ?? null,
              teach_sentiment: (m as { teach_sentiment?: "positive" | "correction" | null }).teach_sentiment ?? null,
              reply_to: replyTo,
              created_at: m.created_at,
            };
          });
        })()}
        backInboxHref={backInboxHref}
      />
    </div>
  );
}
