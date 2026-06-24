// Pure, client-safe age formatting. NO node imports — usable in client components.
export type AgeTone = "new" | "young" | "normal" | "old" | "unknown";

// Render an address age (in days) as a short badge + tone.
// Tiers: <7d 🆕 (red) · 7–30d 🌱 (amber) · 30d–365d normal (months) · ≥365d old (years).
export function formatAge(ageDays: number | null | undefined): {
  text: string;
  tone: AgeTone;
} {
  if (ageDays == null) return { text: "…", tone: "unknown" };
  const d = Math.floor(ageDays);
  if (d < 7) return { text: `🆕 ${d}天`, tone: "new" };
  if (d < 30) return { text: `🌱 ${d}天`, tone: "young" };
  if (d < 365)
    return { text: `${Math.max(1, Math.round(d / 30))}月`, tone: "normal" };
  return { text: `${(d / 365).toFixed(1)}年`, tone: "old" };
}

export const ageColor: Record<AgeTone, string> = {
  new: "#ef4444",
  young: "#f59e0b",
  normal: "#8aa0c0",
  old: "#6f819c",
  unknown: "#6f819c",
};
