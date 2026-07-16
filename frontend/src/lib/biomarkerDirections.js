// Single source of truth for "which way is healthy" per biomarker (spec C).
// Vocabulary matches backend's CARDIAC_METRICS `direction` field exactly
// (higher_better / lower_better / neutral) so frontend and backend never
// disagree. Import this everywhere a direction badge/color is shown —
// PopulationPanel, TimeSeriesPanel, ExplainabilityPanel — instead of each
// component keeping its own copy.

export const BIOMARKER_DIRECTION = {
  heart_rate: 'lower_better',
  stress_index: 'lower_better',
  motion_intensity: 'lower_better',
  cognitive_load_index: 'lower_better',
  rmssd: 'higher_better',
  sdnn: 'higher_better',
  recovery_rate: 'higher_better',
  heart_health_score: 'higher_better',
  risk_score: 'lower_better',
  composure_index_proxy: 'higher_better',
  rr_interval_ms: 'neutral',
  bmi: 'neutral',
  age: 'neutral',
}

export const DIRECTION_COLOR = {
  higher_better: '#0284c7', // sky-600 — matches existing "blue = higher is better"
  lower_better: '#2F8F5B', // success green — matches existing "green = lower is better"
  neutral: null,
}

export function directionFor(feature) {
  return BIOMARKER_DIRECTION[feature] || 'neutral'
}

export function colorForDirection(direction) {
  return DIRECTION_COLOR[direction] ?? null
}
