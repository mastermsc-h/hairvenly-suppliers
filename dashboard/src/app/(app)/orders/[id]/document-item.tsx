"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteDocument } from "@/lib/actions/orders";
import DocumentLink from "./document-link";
import type { OrderDocument } from "@/lib/types";
import { dateTime } from "@/lib/format";
import { t, type Locale } from "@/lib/i18n";

export default function DocumentItem({
  orderId,
  doc,
  isAdmin,
  locale,
  displayName,
}: {
  orderId: string;
  doc: OrderDocument;
  isAdmin: boolean;
  locale: Locale;
  displayName?: string;
}) {
  const displayDoc = displayName ? { ...doc, file_name: displayName } : doc;
  const [pending, start] = useTransition();

  function remove() {
    if (!confirm(t(locale, "doc.confirm_delete"))) return;
    start(async () => {
      await deleteDocument(orderId, doc.id, doc.file_path);
    });
  }

  return (
    <li className="py-3 flex items-center justify-between text-sm">
      <div>
        <DocumentLink doc={displayDoc} />
        <div className="text-xs text-neutral-500">
          {t(locale, `doc.kind.${doc.kind}`)} · {dateTime(doc.created_at)}
        </div>
      </div>
      {isAdmin && (
        <button
          onClick={remove}
          disabled={pending}
          title={t(locale, "common.delete")}
          className="text-neutral-400 hover:text-red-600 p-1"
        >
          <Trash2 size={14} />
        </button>
      )}
    </li>
  );
}
