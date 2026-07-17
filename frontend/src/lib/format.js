// Task 21 — Display Formatting: Heart Health Score and Percentile are shown
// EXACTLY two decimal places everywhere in the UI (e.g. "82.46", "91.28"),
// never fewer (a value like 75.5 must still render as "75.50"). The backend
// already rounds these to 2 decimals (see backend/app/utils.py::round2), but
// JSON doesn't preserve trailing zeros, so the display layer applies
// toFixed(2) explicitly rather than trusting whatever precision survived
// serialization — this is the one place that formatting happens, used by
// every component that renders one of these two figures.

export function formatScore(value) {
  return value != null && !Number.isNaN(Number(value)) ? Number(value).toFixed(2) : '—'
}

export function formatPercentile(value) {
  return value != null && !Number.isNaN(Number(value)) ? `${Number(value).toFixed(2)}th` : '—'
}
