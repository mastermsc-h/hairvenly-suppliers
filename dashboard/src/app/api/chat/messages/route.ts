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
      id, role, content, attachments, tool_calls, agent_id, created_at,
      agent:profiles!chat_messages_agent_id_fkey(display_name,email)
    `)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .limit(50);

  if (since) q = q.gt("created_at", since);
  const { data, error } = await q;
  if (error) {
    console.error("[chat/messages] query error", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const messages = (data ?? []).map(m => ({
    id: m.id,
    role: m.role,
    content: m.content,
    attachments: (m.attachments as unknown) || [],
    tool_calls: m.tool_calls,
    agent_name: (() => {
      const p = m.agent as unknown as { display_name?: string; email?: string } | null;
      return p?.display_name || p?.email || null;
    })(),
    created_at: m.created_at,
  }));

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
