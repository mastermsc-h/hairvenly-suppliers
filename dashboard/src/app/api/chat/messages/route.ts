/**
 * GET /api/chat/messages?sessionId=...&since=ISO
 *
 * Liefert neue Nachrichten für eine Session (Polling).
 */
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const sessionId = url.searchParams.get("sessionId");
  const since = url.searchParams.get("since");
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

  const svc = createServiceClient();
  let q = svc
    .from("chat_messages")
    .select(`
      id, role, content, attachments, tool_calls, agent_id, auto_sent, teach_feedback_at, external_id, reply_to_external_id, created_at,
      agent:profiles!chat_messages_agent_id_fkey(display_name,email)
    `)
    .eq("session_id", sessionId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(50);

  if (since) q = q.gt("created_at", since);
  const { data, error } = await q;
  if (error) {
    console.error("[chat/messages] query error", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Reply-Threading: für referenzierte Messages müssen wir auch die ältere
  // Vorgänger-Message holen (für Preview), da das polling-since-Filter sie
  // sonst ausschließt. Wir holen die referenzierten external_ids separat.
  // id wird mitgeliefert, damit die UI per Klick zur Ursprungs-Message
  // scrollen kann.
  const replyMids = Array.from(new Set(
    (data ?? [])
      .map(m => (m as { reply_to_external_id?: string | null }).reply_to_external_id)
      .filter((v): v is string => !!v)
  ));
  const replyPreviewByExt = new Map<string, { id: string; role: string; content: string | null }>();
  if (replyMids.length > 0) {
    const { data: refs } = await svc.from("chat_messages")
      .select("id, external_id, role, content")
      .eq("session_id", sessionId)
      .in("external_id", replyMids);
    for (const r of refs || []) {
      if (r.external_id) replyPreviewByExt.set(r.external_id, { id: r.id, role: r.role, content: r.content });
    }
  }

  const messages = (data ?? []).map(m => {
    const replyToExt = (m as { reply_to_external_id?: string | null }).reply_to_external_id;
    const replied = replyToExt ? replyPreviewByExt.get(replyToExt) : null;
    // Fallback: reply_to vorhanden aber Original nicht in DB → "external"-Marker
    let replyTo: { id: string | null; role: string; content_preview: string } | null = null;
    if (replied) {
      replyTo = { id: replied.id, role: replied.role, content_preview: (replied.content || "").slice(0, 140) };
    } else if (replyToExt) {
      replyTo = { id: null, role: "external", content_preview: "" };
    }
    return {
      id: m.id,
      role: m.role,
      content: m.content,
      attachments: (m.attachments as unknown) || [],
      tool_calls: m.tool_calls,
      agent_name: (() => {
        const p = m.agent as unknown as { display_name?: string; email?: string } | null;
        return p?.display_name || p?.email || null;
      })(),
      auto_sent: (m as { auto_sent?: boolean }).auto_sent ?? false,
      teach_feedback_at: (m as { teach_feedback_at?: string | null }).teach_feedback_at ?? null,
      reply_to: replyTo,
      created_at: m.created_at,
    };
  });

  // Auch Session-Status mitliefern damit Widget weiß ob Bot oder Mensch antwortet
  const { data: session } = await svc
    .from("chat_sessions")
    .select("status, bot_signature_name, bot_mode")
    .eq("id", sessionId)
    .single();

  // Pending Draft (Bot-Begleitung) — Hash/ID damit Client erkennt ob neu
  const { data: pendingDraft } = await svc
    .from("chat_drafts")
    .select("id, created_at")
    .eq("session_id", sessionId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    messages,
    status: session?.status,
    bot_signature_name: session?.bot_signature_name,
    bot_mode: session?.bot_mode,
    pending_draft_id: pendingDraft?.id || null,
  });
}
