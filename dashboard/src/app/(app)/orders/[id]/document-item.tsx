"use client";

import { useTransition } from "react";
import { Trash2, Truck } from "lucide-react";
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
  shipmentLabel,
}: {
  orderId: string;
  doc: OrderDocument;
  isAdmin: boolean;
  locale: Locale;
  displayName?: string;
  shipmentLabel?: string | null;
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
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <DocumentLink doc={displayDoc} />
          {shipmentLabel && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-full px-1.5 py-0.5">
              <Truck size={9} /> {shipmentLabel}
            </span>
          )}
        </div>
        <div className="text-xs text-neutral-500">
          {t(locale, `doc.kind.${doc.kind}`)} · {dateTime(doc.created_at)}
        </div>
      </div>
      {isAdmin && (
        <button
          onClick={remove}
          disabled={pending}
          title={t(locale, "common.delete")}
          className="text-neutral-400 hover:text-red-600 p-1 shrink-0"
        >
          <Trash2 size={14} />
        </button>
      )}
    </li>
  );
}
