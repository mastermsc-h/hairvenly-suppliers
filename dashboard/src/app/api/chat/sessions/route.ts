/**
 * GET /api/chat/sessions?channel=web&limit=30
 *
 * Liefert Liste der letzten Test-Sessions für die Session-Sidebar.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles").select("is_admin").eq("id", user.id).single();
  return profile?.is_admin ? user : null;
}

export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "auth" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  const all = req.nextUrl.searchParams.get("all"); // "test" → alle web-Sessions löschen
  const svc = createServiceClient();

  if (all === "test") {
    const { error, count } = await svc
      .from("chat_sessions")
      .delete({ count: "exact" })
      .eq("channel", "web");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, deleted: count });
  }

  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { error } = await svc.from("chat_sessions").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const channel = req.nextUrl.searchParams.get("channel") || "web";
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") || "30"), 100);

  const svc = createServiceClient();
  const { data: sessions } = await svc
    .from("chat_sessions")
    .select("id, channel, status, bot_signature_name, created_at, last_message_at")
    .eq("channel", channel)
    .order("last_message_at", { ascending: false })
    .limit(limit);

  if (!sessions) return NextResponse.json({ sessions: [] });

  const sessionIds = sessions.map(s => s.id);
  const { data: firstMessages } = await svc
    .from("chat_messages")
    .select("session_id, role, content, created_at")
    .in("session_id", sessionIds)
    .eq("role", "user")
    .order("created_at", { ascending: true });

  // Erste User-Frage pro Session = Titel-Preview
  const firstByCidn: Record<string, string> = {};
  for (const m of firstMessages ?? []) {
    if (!firstByCidn[m.session_id] && m.content) {
      firstByCidn[m.session_id] = m.content.slice(0, 60);
    }
  }

  return NextResponse.json({
    sessions: sessions.map(s => ({
      id: s.id,
      status: s.status,
      bot_signature_name: s.bot_signature_name,
      preview: firstByCidn[s.id] || "Leerer Chat",
      last_message_at: s.last_message_at,
      created_at: s.created_at,
    })),
  });
}
