"use client";

/**
 * Error-Boundary für die Chat-Inbox. Zeigt den echten Fehler an, statt der
 * generischen "This page couldn't load"-Meldung von Next.js. So sind
 * Render-/Server-Fehler in der Inbox sofort diagnostizierbar.
 */
import { useEffect } from "react";

export default function InboxError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[inbox/error] ", error);
  }, [error]);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="bg-white rounded-2xl border border-red-200 p-6 shadow-sm space-y-4">
        <h1 className="text-lg font-semibold text-red-700">
          Die Inbox konnte nicht geladen werden
        </h1>
        <p className="text-sm text-neutral-600">
          Es ist ein Fehler beim Laden dieser Ansicht aufgetreten. Details:
        </p>
        <pre className="text-xs bg-neutral-50 border border-neutral-200 rounded-lg p-3 overflow-auto whitespace-pre-wrap text-red-800">
          {error?.message || "Unbekannter Fehler"}
          {error?.digest ? `\n\nDigest: ${error.digest}` : ""}
          {error?.stack ? `\n\n${error.stack}` : ""}
        </pre>
        <div className="flex gap-2">
          <button
            onClick={() => reset()}
            className="bg-neutral-900 text-white font-medium rounded-lg px-4 py-2 text-sm"
          >
            Erneut versuchen
          </button>
          <a
            href="/chatbot/inbox"
            className="bg-white text-neutral-700 border border-neutral-300 font-medium rounded-lg px-4 py-2 text-sm"
          >
            Zur vollen Inbox
          </a>
        </div>
      </div>
    </div>
  );
}
