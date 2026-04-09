export const usd = (n: number | null | undefined) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("de-DE", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }).format(n);

export const date = (d: string | null | undefined) =>
  d ? new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(new Date(d)) : "—";

export const dateTime = (d: string | null | undefined) =>
  d
    ? new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(d),
      )
    : "—";
