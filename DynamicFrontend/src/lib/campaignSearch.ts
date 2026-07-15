export function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/[_-]+/g, ' ')
}

/** Multi-token search: every word must appear somewhere in the haystack. */
export function matchesCampaignSearch(haystack: string, query: string) {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const normalized = normalizeSearchText(haystack)
  return tokens.every((token) => normalized.includes(normalizeSearchText(token)))
}

export function rowMatchesCampaignSearch(row: Record<string, string>, query: string) {
  return matchesCampaignSearch(Object.values(row).join(' '), query)
}

export function leadSearchHaystack(
  lead: Record<string, unknown>,
  columnKeys: string[],
  getValue: (lead: Record<string, unknown>, key: string) => unknown,
) {
  const parts = columnKeys.map((key) => String(getValue(lead, key) ?? ''))
  if (lead.callStatus) parts.push(String(lead.callStatus))
  if (lead.data && typeof lead.data === 'object') parts.push(JSON.stringify(lead.data))
  if (lead.extraData && typeof lead.extraData === 'object') parts.push(JSON.stringify(lead.extraData))
  return parts.filter(Boolean).join(' ')
}
