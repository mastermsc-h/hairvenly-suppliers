"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Thin top progress bar that animates while the user navigates between pages.
 *
 * Strategy:
 *   - Listens globally for clicks on internal `<a>` tags.
 *   - Starts the bar as soon as a same-origin navigation is triggered.
 *   - Hides the bar when `usePathname()` reports the new pathname (= the new
 *     server component tree has started rendering).
 */
export default function TopProgress() {
  const pathname = usePathname();
  const [loading, setLoading] = useState(false);
  const startedAtRef = useRef<number | null>(null);
  const lastPathRef = useRef(pathname);

  // When pathname changes, we've arrived at the new route → finish the bar.
  useEffect(() => {
    if (pathname !== lastPathRef.current) {
      lastPathRef.current = pathname;
      // Keep the bar visible briefly to show completion
      if (startedAtRef.current !== null) {
        const delay = Math.max(0, 200 - (Date.now() - startedAtRef.current));
        const t = setTimeout(() => setLoading(false), delay);
        startedAtRef.current = null;
        return () => clearTimeout(t);
      }
      setLoading(false);
    }
  }, [pathname]);

  // Global click interceptor: start bar on in-app navigation clicks.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
      const target = (e.target as HTMLElement | null)?.closest("a");
      if (!target) return;
      const href = target.getAttribute("href");
      if (!href) return;
      // Skip external, anchor, mailto/tel, download, target=_blank
      if (target.getAttribute("target") === "_blank") return;
      if (target.hasAttribute("download")) return;
      if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      if (/^https?:\/\//i.test(href) && !href.startsWith(window.location.origin)) return;
      // Skip clicks that navigate to the same path we're already on
      try {
        const u = new URL(href, window.location.href);
        if (u.pathname === window.location.pathname && u.search === window.location.search) return;
      } catch {
        return;
      }
      startedAtRef.current = Date.now();
      setLoading(true);
    };
    document.addEventListener("click", handler, { capture: true });
    return () => document.removeEventListener("click", handler, { capture: true });
  }, []);

  // Safety: hide after 15s in case pathname never changes (error / blocked nav)
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => setLoading(false), 15000);
    return () => clearTimeout(t);
  }, [loading]);

  return (
    <div
      aria-hidden
      className={`fixed top-0 left-0 right-0 z-[60] h-[3px] pointer-events-none transition-opacity duration-150 ${
        loading ? "opacity-100" : "opacity-0"
      }`}
    >
      <div
        className={`h-full bg-indigo-600 shadow-[0_0_8px_rgba(79,70,229,0.7)] ${
          loading ? "progress-bar-active" : ""
        }`}
        style={{ width: loading ? undefined : "0%" }}
      />
    </div>
  );
}
