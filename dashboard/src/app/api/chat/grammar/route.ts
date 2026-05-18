/**
 * Grammatik-Check für Bot-Begleitung
 * Nimmt einen Text, korrigiert NUR Grammatik/Rechtschreibung/Tippfehler,
 * lässt Inhalt + Tonalität unverändert. Kein Re-Phrasing.
 */
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireProfile } from "@/lib/auth";

const MODEL = "claude-haiku-4-5";

export async function POST(req: NextRequest) {
  await requireProfile();
  const { text } = await req.json();
  if (!text || typeof text !== "string") {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  const trimmed = text.trim();
  if (!trimmed) return NextResponse.json({ corrected: "" });

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: `Du bist ein deutscher Grammatik-Korrektor.

REGELN:
- Korrigiere NUR: Rechtschreibung, Grammatik, Zeichensetzung, Tippfehler
- NICHT ändern: Inhalt, Tonalität, Emojis, Anrede ("meine Liebe", "Schatz"), Formatierung (Markdown), Zeilenumbrüche
- Wenn nichts zu korrigieren ist: Text 1:1 unverändert zurückgeben
- Antworte AUSSCHLIESSLICH mit dem korrigierten Text, OHNE Kommentar/Erklärung/Anführungszeichen`,
      messages: [
        { role: "user", content: trimmed },
      ],
    });
    const out = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map(b => b.text).join("").trim();
    return NextResponse.json({ corrected: out || trimmed });
  } catch (e) {
    console.error("[grammar] failed:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
