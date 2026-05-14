import { requireProfile } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import ChatSessionView from "./session-view";

interface PageProps {
  params: Promise<{ sessionId: string }>;
}

export const dynamic = "force-dynamic";

export default async function ChatSessionPage({ params }: PageProps) {
  await requireProfile();
  const { sessionId } = await params;

  const svc = createServiceClient();
  const { data: session } = await svc
    .from("chat_sessions")
    .select(`
      id, channel, customer_name, status, assigned_to, bot_signature_name,
      last_message_at, created_at,
      assigned_profile:profiles!chat_sessions_assigned_to_fkey(display_name,email)
    `)
    .eq("id", sessionId)
    .single();

  if (!session) notFound();

  // Markieren als "von Mitarbeiter gesehen" — für Unread-Counter
  await svc
    .from("chat_sessions")
    .update({ last_seen_by_agent_at: new Date().toISOString() })
    .eq("id", sessionId);

  const { data: messages } = await svc
    .from("chat_messages")
    .select(`
      id, role, content, attachments, tool_calls, agent_id, created_at,
      agent:profiles!chat_messages_agent_id_fkey(display_name,email)
    `)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-4">
      <Link
        href="/chatbot/inbox"
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
          assigned_name: (() => {
            const p = session.assigned_profile as unknown as { display_name?: string; email?: string } | null;
            return p?.display_name || p?.email || null;
          })(),
        }}
        initialMessages={(messages ?? []).map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          attachments: (m.attachments as { type: string; url: string }[] | null) || [],
          tool_calls: m.tool_calls as { name: string }[] | null,
          agent_name: (() => {
            const p = m.agent as unknown as { display_name?: string; email?: string } | null;
            return p?.display_name || p?.email || null;
          })(),
          created_at: m.created_at,
        }))}
      />
    </div>
  );
}
