"use client";

import { useState, useRef, useTransition, type ReactNode } from "react";
import { GripVertical } from "lucide-react";
import { reorderSuppliers } from "@/lib/actions/suppliers";

export default function SupplierList({
  items,
  isAdmin,
}: {
  items: { id: string; node: ReactNode }[];
  isAdmin: boolean;
}) {
  const [order, setOrder] = useState(items.map((i) => i.id));
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const dragNode = useRef<HTMLDivElement | null>(null);

  // Build a lookup so we render in current order
  const lookup = new Map(items.map((i) => [i.id, i.node]));
  const ordered = order.map((id) => ({ id, node: lookup.get(id)! })).filter((x) => x.node);

  if (!isAdmin) {
    return (
      <div className="space-y-4">
        {ordered.map((item) => (
          <div key={item.id}>{item.node}</div>
        ))}
      </div>
    );
  }

  function handleDragStart(e: React.DragEvent, idx: number) {
    setDragIdx(idx);
    dragNode.current = e.currentTarget as HTMLDivElement;
    e.dataTransfer.effectAllowed = "move";
    // Make drag image slightly transparent
    requestAnimationFrame(() => {
      if (dragNode.current) dragNode.current.style.opacity = "0.4";
    });
  }

  function handleDragEnd() {
    if (dragNode.current) dragNode.current.style.opacity = "1";
    setDragIdx(null);
    setOverIdx(null);
    dragNode.current = null;
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (overIdx !== idx) setOverIdx(idx);
  }

  function handleDrop(e: React.DragEvent, dropIdx: number) {
    e.preventDefault();
    if (dragIdx === null || dragIdx === dropIdx) return;
    const newOrder = [...order];
    const [moved] = newOrder.splice(dragIdx, 1);
    newOrder.splice(dropIdx, 0, moved);
    setOrder(newOrder);
    startTransition(async () => {
      await reorderSuppliers(newOrder);
    });
  }

  return (
    <div className="space-y-4">
      {ordered.map((item, idx) => (
        <div
          key={item.id}
          draggable
          onDragStart={(e) => handleDragStart(e, idx)}
          onDragEnd={handleDragEnd}
          onDragOver={(e) => handleDragOver(e, idx)}
          onDrop={(e) => handleDrop(e, idx)}
          className={`relative group transition-transform ${
            overIdx === idx && dragIdx !== null && dragIdx !== idx
              ? "ring-2 ring-indigo-300 rounded-2xl"
              : ""
          } ${pending ? "opacity-70 pointer-events-none" : ""}`}
        >
          {/* Drag handle */}
          <div className="absolute left-0 top-0 bottom-0 z-10 flex items-center -ml-7 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing">
            <GripVertical size={16} className="text-neutral-400" />
          </div>
          {item.node}
        </div>
      ))}
    </div>
  );
}
