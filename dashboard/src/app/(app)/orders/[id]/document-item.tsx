"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteDocument } from "@/lib/actions/orders";
import DocumentLink from "./document-link";
import { DOCUMENT_KIND_LABELS, type OrderDocument } from "@/lib/types";
import { dateTime } from "@/lib/format";

export default function DocumentItem({
  orderId,
  doc,
  isAdmin,
  displayName,
}: {
  orderId: string;
  doc: OrderDocument;
  isAdmin: boolean;
  displayName?: string;
}) {
  const displayDoc = displayName ? { ...doc, file_name: displayName } : doc;
  const [pending, start] = useTransition();

  function remove() {
    if (!confirm("Dokument wirklich löschen?")) return;
    start(async () => {
      await deleteDocument(orderId, doc.id, doc.file_path);
    });
  }

  return (
    <li className="py-3 flex items-center justify-between text-sm">
      <div>
        <DocumentLink doc={displayDoc} />
        <div className="text-xs text-neutral-500">
          {DOCUMENT_KIND_LABELS[doc.kind]} · {dateTime(doc.created_at)}
        </div>
      </div>
      {isAdmin && (
        <button
          onClick={remove}
          disabled={pending}
          title="Löschen"
          className="text-neutral-400 hover:text-red-600 p-1"
        >
          <Trash2 size={14} />
        </button>
      )}
    </li>
  );
}
