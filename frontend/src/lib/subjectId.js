// Canonical subject ID display: single-digit numeric subject IDs are shown
// zero-padded to 2 digits (S1 -> S01 ... S9 -> S09), S10+ unchanged. This
// normalizes at the display/search layer only — underlying stored IDs
// aren't renamed, which would otherwise mean touching every Mongo
// collection (subjects/sessions/timeseries/insights) and every existing
// /app/subjects/:id URL.
export function formatSubjectId(id) {
  if (!id) return ''
  const m = String(id).trim().match(/^([A-Za-z]*)(\d+)$/)
  if (!m) return String(id).toUpperCase()
  const [, prefix, digits] = m
  const padded = digits.length === 1 ? digits.padStart(2, '0') : digits
  return `${prefix.toUpperCase()}${padded}`
}

// Whether `id` should show up for a typed `query`.
// A bare "letter + single digit" query (e.g. "S1") is unambiguous once
// zero-padded, so it's treated as an EXACT match against the canonical id
// instead of a prefix — otherwise "S1" would still prefix-match S10-S19 and
// reproduce the exact ambiguity this was meant to fix. Any other query
// (e.g. "S10", "S0", or just "S") falls back to normal prefix search so
// browsing-while-typing still works.
export function subjectIdMatches(id, query) {
  const q = String(query || '').trim()
  if (!q) return true
  const idNorm = formatSubjectId(id)
  if (/^[A-Za-z]\d$/.test(q)) {
    return idNorm.toLowerCase() === formatSubjectId(q).toLowerCase()
  }
  return idNorm.toLowerCase().startsWith(q.toLowerCase())
}
