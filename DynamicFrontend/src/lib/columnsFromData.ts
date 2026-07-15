export type ColDef = { id: string; label: string }

function humanize(id: string): string {
  return id
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim()
}

/** Prefer known labels; order follows the first data row keys. */
export function columnsFromData(rows: Record<string, string>[], preferred: ColDef[]): ColDef[] {
  if (!rows?.length) return preferred
  const pref = new Map(preferred.map((c) => [c.id, c]))
  return Object.keys(rows[0]).map((id) => pref.get(id) ?? { id, label: humanize(id) })
}
