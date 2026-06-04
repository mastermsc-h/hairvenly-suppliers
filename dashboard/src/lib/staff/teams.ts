import type { StaffTeam } from "@/lib/types";

export const TEAMS: { value: StaffTeam; label: string; chip: string; bar: string }[] = [
  { value: "salon",        label: "Salon",        chip: "bg-rose-100 text-rose-800",       bar: "bg-rose-500" },
  { value: "marketing",    label: "Marketing",    chip: "bg-violet-100 text-violet-800",   bar: "bg-violet-500" },
  { value: "kundenservice", label: "Kundenservice", chip: "bg-sky-100 text-sky-800",       bar: "bg-sky-500" },
  { value: "lager",        label: "Lager",        chip: "bg-amber-100 text-amber-800",     bar: "bg-amber-500" },
];

export function teamMeta(team: string) {
  return TEAMS.find((t) => t.value === team) ?? { value: team as StaffTeam, label: team, chip: "bg-neutral-100 text-neutral-700", bar: "bg-neutral-400" };
}
