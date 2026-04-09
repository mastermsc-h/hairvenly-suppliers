"use client";

import { useRouter } from "next/navigation";

export default function BackLink() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push("/");
      }}
      className="text-sm text-neutral-500 hover:text-neutral-900"
    >
      ← Zurück
    </button>
  );
}
