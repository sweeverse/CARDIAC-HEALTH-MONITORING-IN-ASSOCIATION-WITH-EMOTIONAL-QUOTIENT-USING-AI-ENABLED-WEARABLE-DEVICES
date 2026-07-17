import { directionFor } from '../lib/biomarkerDirections.js'

// Consistent, cohort-wide color coding for "which way is healthy" (spec
// A.2 / C): green = lower is better, blue = higher is better, no badge for
// neutral biomarkers (e.g. age isn't good/bad, it just is). Shared across
// PopulationPanel, TimeSeriesPanel, and ExplainabilityPanel so the same
// biomarker always shows the same color everywhere in the app.
export default function DirectionBadge({ feature }) {
  const direction = directionFor(feature)
  if (direction === 'neutral') return null
  const lowerBetter = direction === 'lower_better'
  return (
    <span
      className={`inline-flex items-center text-[10px] font-mono font-bold px-1 rounded ${
        lowerBetter ? 'text-success bg-success/10' : 'text-sky-600 bg-sky-500/10 dark:text-sky-400'
      }`}
      title={lowerBetter ? 'Lower values are healthier' : 'Higher values are healthier'}
    >
      {lowerBetter ? '\u2193 better' : '\u2191 better'}
    </span>
  )
}
