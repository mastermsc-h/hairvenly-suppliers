"use client";

import { useState } from "react";
import { getSignedUrl } from "@/lib/actions/orders";
import type { OrderDocument } from "@/lib/types";

export default function DocumentLink({ doc }: { doc: OrderDocument }) {
  const [loading, setLoading] = useState(false);

  async function open() {
    setLoading(true);
    const url = await getSignedUrl(doc.file_path);
    setLoading(false);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <button
      onClick={open}
      disabled={loading}
      className="text-blue-600 hover:underline text-sm font-medium"
    >
      {doc.file_name}
    </button>
  );
}
