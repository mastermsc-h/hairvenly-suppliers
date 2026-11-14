/**
 * "Hi" — Hairvenly Intelligence. Nur für Admins.
 * POST { verlauf: MessageParam[], frage: string } → NDJSON-Stream:
 *   {t:"text", d}           Textstück der Antwort
 *   {t:"werkzeug", label}   Hi schaut gerade irgendwo nach
 *   {t:"fertig", verlauf}   kompletter Verlauf (append-only, inkl. Denk- und Werkzeugblöcke) zum Weiterreden
 *   {t:"fehler", text}
 * Der Verlauf wird nur angehängt, nie bearbeitet (Denkblöcke von Claude Opus 5.5 sind an den
 * Gesprächsverlauf gebunden); muss er gekürzt werden, entfernt der Client alle Denkblöcke.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { HI_SYSTEM } from "@/lib/hi/system";
import { WERKZEUGE, fuehreAus, werkzeugLabel } from "@/lib/hi/werkzeuge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MODEL = "claude-opus-5-5";
const MAX_RUNDEN = 16;
// Server-seitiger Ausweichweg, falls das Modell eine Antwort aus Sicherheitsgründen ablehnt
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
let fallbackAus = false;

const client = new Anthropic();
const TOOLS: Anthropic.Tool[] = WERKZEUGE.map((w) => ({ ...w, eager_input_streaming: true }));

function ohneDenkbloecke(verlauf: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  return verlauf.map((m) =>
    typeof m.content === "string" ? m : { ...m, content: m.content.filter((b) => b.type !== "thinking" && b.type !== "redacted_thinking") },
  );
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Nicht angemeldet", { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return new Response("Nur für Admins", { status: 403 });

  let body: { verlauf?: unknown; frage?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response("Ungültige Anfrage", { status: 400 });
  }
  const frage = typeof body.frage === "string" ? body.frage.trim().slice(0, 8000) : "";
  if (!frage) return new Response("Frage fehlt", { status: 400 });
  const vorher = Array.isArray(body.verlauf) ? (body.verlauf as Anthropic.MessageParam[]) : [];

  const heute = new Date().toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
  let messages: Anthropic.MessageParam[] = [...vorher, { role: "user", content: `${frage}\n\n(Heute ist ${heute}.)` }];

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      let ohneDenken = false;
      let jsonVersuche = 0;
      try {
        for (let runde = 0; runde < MAX_RUNDEN; runde++) {
          const params = {
            model: MODEL,
            max_tokens: 32000,
            thinking: { type: "adaptive" as const },
            output_config: { effort: "high" as const },
            system: [{ type: "text" as const, text: HI_SYSTEM, cache_control: { type: "ephemeral" as const } }],
            tools: TOOLS,
            cache_control: { type: "ephemeral" as const },
            messages,
            ...(fallbackAus ? {} : { fallbacks: "default" }),
          } as Anthropic.MessageStreamParams;

          let message: Anthropic.Message;
          try {
            const s = client.messages.stream(params, fallbackAus ? undefined : { headers: { "anthropic-beta": FALLBACK_BETA } });
            s.on("text", (d) => send({ t: "text", d }));
            message = await s.finalMessage();
            jsonVersuche = 0;
          } catch (err) {
            if (err instanceof Anthropic.BadRequestError) {
              // Ausweichweg nicht freigeschaltet → ohne weiter
              if (!fallbackAus && /fallback/i.test(err.message)) {
                fallbackAus = true;
                runde--;
                continue;
              }
              // Denkblock passt nicht mehr zum Verlauf → einmal ohne Denkblöcke
              if (!ohneDenken && /signature|thinking/i.test(err.message)) {
                ohneDenken = true;
                messages = ohneDenkbloecke(messages);
                runde--;
                continue;
              }
              throw err;
            }
            if (err instanceof Anthropic.APIError) throw err;
            // Werkzeug-Eingabe war kein gültiges JSON (eager streaming) → Runde neu
            if (jsonVersuche++ < 2) {
              runde--;
              continue;
            }
            throw err;
          }

          messages = [...messages, { role: "assistant", content: message.content }];

          if (message.stop_reason === "refusal") {
            send({ t: "text", d: "\n\nDazu kann ich leider keine Antwort geben." });
            break;
          }
          if (message.stop_reason === "pause_turn") continue;
          const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
          if (message.stop_reason === "max_tokens" && toolUses.length) {
            // Abgeschnittene Werkzeug-Eingabe nie ausführen; der letzte Zug fällt weg (nichts folgt ihm)
            messages = messages.slice(0, -1);
            send({ t: "text", d: "\n\n(Die Antwort wurde zu lang — bitte die Frage enger fassen.)" });
            break;
          }
          if (message.stop_reason !== "tool_use" || toolUses.length === 0) break;

          for (const t of toolUses) send({ t: "werkzeug", label: werkzeugLabel(t.name, t.input) });
          const ergebnisse = await Promise.all(toolUses.map((t) => fuehreAus(t.name, t.input)));
          messages = [
            ...messages,
            {
              role: "user",
              content: toolUses.map((t, i) => ({ type: "tool_result" as const, tool_use_id: t.id, content: ergebnisse[i].inhalt, ...(ergebnisse[i].fehler ? { is_error: true } : {}) })),
            },
          ];
          send({ t: "denkt" });
        }
        send({ t: "fertig", verlauf: messages });
      } catch (err) {
        console.error("[hi]", err);
        const text =
          err instanceof Anthropic.RateLimitError ? "Gerade sind zu viele Anfragen unterwegs — bitte gleich noch einmal versuchen."
          : err instanceof Anthropic.APIError ? `Die KI ist gerade nicht erreichbar (${err.status ?? "Fehler"}).`
          : "Da ist etwas schiefgelaufen.";
        send({ t: "fehler", text });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
