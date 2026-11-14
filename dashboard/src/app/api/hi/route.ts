/**
 * "Hi" — Hairvenly Intelligence. Nur für Admins.
 * POST { verlauf: MessageParam[], frage: string, modus?: "normal" | "gruendlich" } → NDJSON-Stream:
 *   {t:"text", d}           Textstück der Antwort
 *   {t:"werkzeug", label}   Hi schaut gerade irgendwo nach
 *   {t:"kosten", usd, eur}  Kosten dieser Frage
 *   {t:"fertig", verlauf}   Verlauf zum Weiterreden — nur Fragen und Antworttexte
 *   {t:"fehler", text}
 * Kosten: Frühere Fragen gehen nur als Text mit (ohne Rohdaten der Werkzeuge und ohne Denkblöcke);
 * innerhalb einer Frage wird der Verlauf nur angehängt (Denkblöcke sind an ihn gebunden). Jede
 * Frage wird mit Tokens und Kosten in hi_nutzung protokolliert.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { HI_SYSTEM } from "@/lib/hi/system";
import { WERKZEUGE, fuehreAus, werkzeugLabel } from "@/lib/hi/werkzeuge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MODEL = "claude-opus-5-5";
// Listenpreise Claude Opus 5.5 in USD je 1 Mio. Tokens (Cache-Schreiben 5 min = 1,25 × Eingabe)
const PREIS = { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 };
const USD_PRO_EUR = 1.12;
const MAX_RUNDEN = 16;
// Server-seitiger Ausweichweg, falls das Modell eine Antwort aus Sicherheitsgründen ablehnt
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
let fallbackAus = false;

const client = new Anthropic();
const TOOLS: Anthropic.Tool[] = WERKZEUGE.map((w) => ({ ...w, eager_input_streaming: true }));

/**
 * Früherer Verlauf nur als Text: Fragen und Antworten, ohne Werkzeug-Rohdaten und Denkblöcke.
 * Ohne Denkblöcke gibt es nichts, was an den alten Verlauf gebunden wäre — das Kürzen ist erlaubt.
 */
function kompakt(verlauf: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of verlauf) {
    const text =
      typeof m.content === "string"
        ? m.content
        : m.content.filter((b): b is Anthropic.TextBlockParam => b.type === "text").map((b) => b.text).join("\n\n");
    if (!text.trim()) continue;
    const letzte = out.at(-1);
    if (letzte && letzte.role === m.role) letzte.content = `${letzte.content as string}\n\n${text}`;
    else out.push({ role: m.role, content: text });
  }
  // Muss mit einer Frage beginnen und mit einer Antwort enden (die neue Frage folgt)
  while (out.length && out[0].role !== "user") out.shift();
  if (out.at(-1)?.role === "user") out.pop();
  return out.slice(-16);
}

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

  let body: { verlauf?: unknown; frage?: unknown; modus?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response("Ungültige Anfrage", { status: 400 });
  }
  const frage = typeof body.frage === "string" ? body.frage.trim().slice(0, 8000) : "";
  if (!frage) return new Response("Frage fehlt", { status: 400 });
  const vorher = kompakt(Array.isArray(body.verlauf) ? (body.verlauf as Anthropic.MessageParam[]) : []);
  // Standard: mittlere Denktiefe (Standard von Opus 5.5); "gründlich" für schwierige Analysen
  const modus = body.modus === "gruendlich" ? "gruendlich" : "normal";
  const effort = modus === "gruendlich" ? ("high" as const) : ("medium" as const);

  const heute = new Date().toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
  const frageText = `${frage}\n\n(Heute ist ${heute}.)`;
  let messages: Anthropic.MessageParam[] = [...vorher, { role: "user", content: frageText }];
  const beginn = Date.now();
  const nutzung = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, runden: 0 };
  const werkzeuge: string[] = [];
  let antwort = "";

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
            output_config: { effort },
            system: [{ type: "text" as const, text: HI_SYSTEM, cache_control: { type: "ephemeral" as const } }],
            tools: TOOLS,
            cache_control: { type: "ephemeral" as const },
            messages,
            ...(fallbackAus ? {} : { fallbacks: "default" }),
          } as Anthropic.MessageStreamParams;

          let message: Anthropic.Message;
          try {
            const s = client.messages.stream(params, fallbackAus ? undefined : { headers: { "anthropic-beta": FALLBACK_BETA } });
            s.on("text", (d) => {
              antwort += d;
              send({ t: "text", d });
            });
            message = await s.finalMessage();
            jsonVersuche = 0;
            nutzung.runden++;
            nutzung.input += message.usage.input_tokens;
            nutzung.cacheWrite += message.usage.cache_creation_input_tokens ?? 0;
            nutzung.cacheRead += message.usage.cache_read_input_tokens ?? 0;
            nutzung.output += message.usage.output_tokens;
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

          for (const t of toolUses) {
            werkzeuge.push(t.name);
            send({ t: "werkzeug", label: werkzeugLabel(t.name, t.input) });
          }
          if (antwort && !antwort.endsWith("\n")) antwort += "\n\n";
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
        const usd = (nutzung.input * PREIS.input + nutzung.cacheWrite * PREIS.cacheWrite + nutzung.cacheRead * PREIS.cacheRead + nutzung.output * PREIS.output) / 1e6;
        send({ t: "kosten", usd: Math.round(usd * 1000) / 1000, eur: Math.round((usd / USD_PRO_EUR) * 1000) / 1000 });
        await createServiceClient()
          .from("hi_nutzung")
          .insert({
            profil_id: user.id, frage: frage.slice(0, 500), modell: MODEL, modus, runden: nutzung.runden, werkzeuge,
            input_tokens: nutzung.input, cache_write_tokens: nutzung.cacheWrite, cache_read_tokens: nutzung.cacheRead, output_tokens: nutzung.output,
            kosten_usd: Math.round(usd * 10000) / 10000, dauer_ms: Date.now() - beginn,
          })
          .then(({ error }) => error && console.warn("[hi] Nutzung nicht gespeichert:", error.message));
        send({ t: "fertig", verlauf: [...vorher, { role: "user", content: frageText }, ...(antwort.trim() ? [{ role: "assistant", content: antwort.trim() }] : [])] });
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
