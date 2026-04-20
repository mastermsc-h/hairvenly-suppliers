"use client";

export default function TrackingLink({
  number,
  url,
  maxWidth = 140,
}: {
  number: string;
  url?: string | null;
  maxWidth?: number;
}) {
  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-[10px] text-blue-600 hover:underline truncate inline-block"
        style={{ maxWidth }}
        title={number}
      >
        {number}
      </a>
    );
  }
  return (
    <span
      className="text-[10px] text-neutral-400 truncate inline-block"
      style={{ maxWidth }}
      title={number}
    >
      {number}
    </span>
  );
}
