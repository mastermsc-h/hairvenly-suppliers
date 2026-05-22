/**
 * GET /api/chat/test-sanitizers?text=...
 *
 * Diagnose-Endpoint: jagt einen gegebenen Text durch ALLE Output-Sanitizer
 * und gibt zurück:
 *  - input:       Original-Text
 *  - output:      sanitized Text
 *  - changes:     Diff der einzelnen Sanitizer-Stufen
 *
 * Nützlich um zu verifizieren, dass der aktuelle Code in Production aktiv ist.
 * Auch: gibt commit-hash zurück (build-time), damit klar ist welche Version live ist.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  stripSelfReferentialDisclaimer,
  stripProactivePhotoOffer,
  scrubSupplierNames,
  scrubWeekendTrap,
  scrubClosedHandover,
  stripColorUrlMismatch,
  emDashBrake,
} from "@/lib/chatbot/output-sanitizers";

export async function GET(req: NextRequest) {
  const text = req.nextUrl.searchParams.get("text");
  if (!text) {
    return NextResponse.json({
      usage: "GET /api/chat/test-sanitizers?text=URL-encoded-bot-output",
      note: "Pass any Bot-Output text and the endpoint returns the sanitized version + per-step diff. Useful for debugging which sanitizer is/isn't catching something.",
    });
  }
  const askedForPhotos = req.nextUrl.searchParams.get("askedForPhotos") === "true";

  const steps: Array<{ name: string; text: string; changed: boolean }> = [];
  let current = text;

  const apply = (name: string, fn: (s: string) => string) => {
    const before = current;
    current = fn(current);
    steps.push({ name, text: current, changed: before !== current });
  };

  apply("stripSelfReferentialDisclaimer", t => stripSelfReferentialDisclaimer(t));
  apply("stripProactivePhotoOffer", t => stripProactivePhotoOffer(t, askedForPhotos));
  apply("scrubWeekendTrap", t => scrubWeekendTrap(t));
  apply("scrubClosedHandover", t => scrubClosedHandover(t));
  apply("scrubSupplierNames", t => scrubSupplierNames(t));
  apply("stripColorUrlMismatch", t => stripColorUrlMismatch(t));
  apply("emDashBrake", t => emDashBrake(t));

  return NextResponse.json({
    input: text,
    output: current,
    appliedSteps: steps.filter(s => s.changed).map(s => s.name),
    allSteps: steps.map(s => ({ name: s.name, changed: s.changed })),
  });
}
