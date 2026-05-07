"use client";

import { useEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { CheckCircle2 } from "lucide-react";

interface Props {
  active: boolean;
  userName: string | null;
  orderName: string;
  /** Wenn true, schrumpft die Animation nach dem Konfetti zu einem kleinen
   *  persistenten Badge (für die /pack/display-Seite). */
  persistAfter?: boolean;
  /** Wird aufgerufen sobald die Hauptanimation durch ist (~5s), kann
   *  vom Parent ignoriert werden. */
  onAnimationEnd?: () => void;
}

/**
 * Vollbild-Konfetti-Overlay mit großem "Gut gemacht <Name>"-Text.
 * - Triggert mehrere Konfetti-Bursts über ~3-4 Sekunden
 * - Nach 5s entweder ausblenden oder auf kleines Badge zusammenschrumpfen
 *   (je nach persistAfter-prop)
 */
export default function CelebrationOverlay({
  active,
  userName,
  orderName,
  persistAfter = false,
  onAnimationEnd,
}: Props) {
  const [phase, setPhase] = useState<"hidden" | "burst" | "shrunk">("hidden");
  const cancelRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!active) {
      setPhase("hidden");
      return;
    }
    setPhase("burst");
    cancelRef.current?.();
    cancelRef.current = launchConfetti();

    const timer = setTimeout(() => {
      onAnimationEnd?.();
      setPhase(persistAfter ? "shrunk" : "hidden");
    }, 4500);

    return () => {
      clearTimeout(timer);
      cancelRef.current?.();
      cancelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  if (phase === "hidden") return null;

  // Großer Vollbild-Burst
  if (phase === "burst") {
    return (
      <div className="fixed inset-0 z-[60] pointer-events-none flex items-center justify-center">
        <div className="absolute inset-0 bg-emerald-500/20 backdrop-blur-sm animate-fade-in" />
        <div className="relative text-center px-8 animate-celebrate-in">
          <div className="inline-flex items-center justify-center w-32 h-32 md:w-40 md:h-40 rounded-full bg-white shadow-2xl mb-6">
            <CheckCircle2 size={96} className="text-emerald-600" strokeWidth={2.5} />
          </div>
          <div className="text-3xl md:text-5xl font-black text-emerald-700 drop-shadow-lg uppercase tracking-wide">
            Gut gemacht
          </div>
          {userName && (
            <div className="text-5xl md:text-8xl font-black text-emerald-800 drop-shadow-2xl mt-2">
              {userName}!
            </div>
          )}
          <div className="text-lg md:text-2xl text-emerald-900/80 font-medium mt-4">
            {orderName} ist fertig 🎉
          </div>
        </div>
        <style>{`
          @keyframes fade-in { from { opacity: 0 } to { opacity: 1 } }
          @keyframes celebrate-in {
            0% { transform: scale(0.3) rotate(-12deg); opacity: 0; }
            45% { transform: scale(1.15) rotate(4deg); opacity: 1; }
            60% { transform: scale(0.95) rotate(-2deg); }
            100% { transform: scale(1) rotate(0); opacity: 1; }
          }
          .animate-fade-in { animation: fade-in 0.3s ease-out forwards; }
          .animate-celebrate-in { animation: celebrate-in 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
        `}</style>
      </div>
    );
  }

  // Schrumpf-Modus für Display-Page: kleines persistentes Badge oben rechts
  return (
    <div className="fixed top-6 right-6 z-50 pointer-events-none animate-shrink-in">
      <div className="flex items-center gap-3 bg-emerald-600 text-white rounded-2xl px-5 py-3 shadow-2xl border-2 border-emerald-700">
        <CheckCircle2 size={32} strokeWidth={2.5} />
        <div>
          <div className="text-xs uppercase tracking-widest opacity-90">Gut gemacht</div>
          {userName && <div className="text-xl font-black leading-tight">{userName}!</div>}
        </div>
      </div>
      <style>{`
        @keyframes shrink-in {
          0% { transform: scale(2.5); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
        .animate-shrink-in { animation: shrink-in 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
      `}</style>
    </div>
  );
}

/**
 * Schießt mehrere Konfetti-Bursts hintereinander für ~4 Sekunden.
 * Returns eine cleanup-funktion zum vorzeitigen abbrechen.
 */
function launchConfetti(): () => void {
  const duration = 4000;
  const animationEnd = Date.now() + duration;
  let cancelled = false;

  const colors = ["#22c55e", "#10b981", "#facc15", "#f97316", "#ec4899", "#3b82f6", "#a855f7"];

  // 1) Großer initialer Burst von der Mitte
  confetti({
    particleCount: 150,
    spread: 80,
    origin: { y: 0.6 },
    colors,
    scalar: 1.2,
  });

  // 2) Side-Cannons — links und rechts schießen wiederholt
  function frame() {
    if (cancelled) return;
    const timeLeft = animationEnd - Date.now();
    if (timeLeft <= 0) return;
    const particleCount = Math.max(20, 50 * (timeLeft / duration));
    confetti({
      particleCount,
      angle: 60,
      spread: 55,
      origin: { x: 0, y: 0.7 },
      colors,
    });
    confetti({
      particleCount,
      angle: 120,
      spread: 55,
      origin: { x: 1, y: 0.7 },
      colors,
    });
    setTimeout(frame, 250);
  }
  frame();

  // 3) Nach 1.5s nochmal ein zentraler Star-Burst
  setTimeout(() => {
    if (cancelled) return;
    confetti({
      particleCount: 100,
      startVelocity: 50,
      spread: 360,
      origin: { x: 0.5, y: 0.5 },
      colors,
      shapes: ["star"],
      scalar: 1.5,
    });
  }, 1500);

  return () => {
    cancelled = true;
  };
}
