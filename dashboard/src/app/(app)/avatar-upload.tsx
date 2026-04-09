"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { Camera } from "lucide-react";
import { uploadSupplierAvatar, removeSupplierAvatar } from "@/lib/actions/suppliers";

/**
 * Rundes Avatar (Gesichtsfoto) des Lieferanten.
 * - Read-only: zeigt nur den Kreis (oder einen Initial-Platzhalter).
 * - Admin: hover zeigt einen kleinen Kamera-Overlay-Button zum Hochladen.
 */
export default function AvatarUpload({
  supplierId,
  url,
  name,
  isAdmin,
}: {
  supplierId: string;
  url: string | null;
  name: string;
  isAdmin: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function onFileChange() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    start(async () => {
      const res = await uploadSupplierAvatar(supplierId, fd);
      if (res?.error) setError(res.error);
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  const initial = name.charAt(0).toUpperCase();

  return (
    <div className="relative group shrink-0">
      <div className="w-12 h-12 rounded-full overflow-hidden border border-neutral-200 bg-neutral-100 flex items-center justify-center text-neutral-400 text-sm font-medium">
        {url ? (
          <Image src={url} alt={name} width={48} height={48} className="object-cover w-full h-full" unoptimized />
        ) : (
          <span>{initial}</span>
        )}
      </div>

      {isAdmin && (
        <label
          title={url ? "Avatar ändern" : "Avatar hochladen"}
          className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-neutral-900 text-white flex items-center justify-center shadow cursor-pointer opacity-0 group-hover:opacity-100 transition"
        >
          <Camera size={11} />
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={onFileChange}
            disabled={pending}
            className="hidden"
          />
        </label>
      )}

      {error && (
        <div className="absolute top-full left-0 mt-1 text-[10px] text-red-600 whitespace-nowrap">
          {error}
        </div>
      )}
    </div>
  );
}

export { removeSupplierAvatar };
