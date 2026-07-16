import { useEffect, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts'
import { Loader2, Info, Activity, ChevronDown } from 'lucide-react'
import { Endpoints } from '../lib/api.js'
import DirectionBadge from './DirectionBadge.jsx'
import { onDataChanged } from '../lib/syncBus.js'
import { formatScore } from '../lib/format.js'

// Task 20 redesign: collapsible section used for every card on this page.
// Pure-CSS height animation (grid-template-rows 0fr -> 1fr) rather than a
// JS-measured max-height — animates smoothly with zero layout-thrash and
// works for content of any length.
function Accordion({ title, icon: Icon, defaultOpen = false, badge, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 p-5 text-left hover:bg-paper/60 dark:hover:bg-dark-surface/40 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          {Icon && <Icon className="w-4 h-4 text-brand-red shrink-0" />}
          <h3 className="font-display font-semibold text-base dark:text-dark-text truncate">{title}</h3>
          {badge}
        </div>
        <ChevronDown className={`w-4 h-4 text-ink/65 dark:text-dark-muted shrink-0 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className="grid transition-[grid-template-rows] duration-300 ease-out" style={{ gridTemplateRows: open ? '1fr' : '0fr' }}>
        <div className="overflow-hidden">
          <div className="px-5 pb-5">{children}</div>
        </div>
      </div>
    </div>
  )
}

const FEATURE_LABELS = {
  heart_rate: 'Heart Rate', rmssd: 'HRV (RMSSD)', sdnn: 'HRV (SDNN)',
  stress_index: 'Stress Index', recovery_rate: 'Recovery Rate',
  motion_intensity: 'Motion', bmi: 'BMI', age: 'Age', rr_interval_ms: 'RR Interval',
}

const FEATURE_CONTEXT = {
  heart_rate: 'Resting heart rate reflects baseline cardiovascular workload.',
  rmssd: 'RMSSD measures beat-to-beat variation and reflects vagal (calming) nervous system tone.',
  sdnn: 'SDNN captures overall heart rhythm variability across the session.',
  stress_index: 'Stress Index tracks sympathetic (fight-or-flight) nervous system dominance.',
  recovery_rate: 'Recovery Rate measures how quickly heart rate drops after exertion — only meaningful right after physical effort.',
  rr_interval_ms: 'RR interval is the time between heartbeats — shorter intervals mean a faster heart rate.',
  bmi: 'BMI is a proxy for cardiac workload.',
}

// Shown on hover over each row's (?) icon — the actual math behind the bar/points.
function formulaTooltip(feature, b) {
  if (feature === 'recovery_rate') {
    return 'Points = full credit when the reading is negative or near zero (nothing to recover from at rest); ' +
      'otherwise scaled 0-100% of the healthy ceiling. Points awarded × cohort weight ÷ 100 = this row\'s score contribution.'
  }
  return `Points = how close ${b.value} is to the healthy range (${b.healthy_range}), scaled against this ` +
    `biomarker's weight in this breakdown. Awarded ${b.points_awarded ?? '—'} of ${b.max_points ?? '—'} possible points.`
}

function plainLanguageInsight(feature, value, healthyRange, impact) {
  const label = FEATURE_LABELS[feature] || feature
  const context = FEATURE_CONTEXT[feature] || ''
  const v = parseFloat(value)

  if (feature === 'recovery_rate') {
    if (v <= 0) return `${label} is ${v} for this subject — near zero or negative is expected during rest or sitting sessions, so this isn't dragging the score down. ${context}`
    return `${label} is ${value} for this subject, meaning the heart is actively slowing down between windows — a positive, measured sign of cardiac adaptability. ${context}`
  }

  const isGood = impact == null || impact >= -0.5
  if (isGood) {
    return `${label} is ${value}, within this subject's healthy range (${healthyRange}) — not a drag on the score. ${context}`
  }
  return `${label} is ${value} for this subject, outside the healthy range (${healthyRange}) and costing about ` +
    `${Math.abs(impact).toFixed(1)} points in this breakdown. ${context}`
}

export default function ExplainabilityPanel({ subjectId }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [validation, setValidation] = useState(null)

  useEffect(() => {
    setLoading(true)
    Endpoints.getExplainability(subjectId).then((res) => setData(res.data)).finally(() => setLoading(false))
    Endpoints.getUnsupervisedValidation().then((res) => setValidation(res.data)).catch(() => {})
  }, [subjectId])

  useEffect(() => {
    return onDataChanged(() => {
      Endpoints.getExplainability(subjectId).then((res) => setData(res.data)).catch(() => {})
      Endpoints.getUnsupervisedValidation().then((res) => setValidation(res.data)).catch(() => {})
    })
  }, [subjectId])

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-brand-red" /></div>
  if (!data) return null

  const breakdown = data.heart_health_score_breakdown || []
  const contributions = data.risk_assessment?.feature_contributions || []
  const driverChartData = [...contributions]
    .sort((a, b) => Math.abs(b.shap_value) - Math.abs(a.shap_value))
    .map((c) => ({
      feature: FEATURE_LABELS[c.feature] || c.feature.replace(/_/g, ' '),
      magnitude: Math.abs(c.shap_value),
      signed: c.shap_value,
    }))

  return (
    <div className="space-y-4 animate-[fadeIn_0.4s_ease-out]">
      <style>{'@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}'}</style>

      <Accordion
        title="Biomarker deviation breakdown"
        icon={Info}
      >
        <p className="text-xs text-ink/70 dark:text-dark-muted mb-4 flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Points awarded out of each biomarker's max, based on distance from this cohort's healthy range.
          Hover a row for details.
        </p>

        <div className="space-y-4">
          {breakdown.map((b) => {
            const maxPts = Math.abs(b.max_points) || 20
            const ptsAwarded = Math.max(0, b.points_awarded ?? 0)
            const barPct = Math.max(0, Math.min(100, (ptsAwarded / maxPts) * 100))
            const barColor = b.impact >= -2 ? '#2F8F5B' : b.impact >= -8 ? '#DC5F00' : '#CF0A0A'

            return (
              <div key={b.feature}>
                <div
                  className="flex items-center gap-3 cursor-help"
                  title={formulaTooltip(b.feature, b)}
                >
                  <div className="flex items-center gap-1 text-xs font-semibold text-ink/80 dark:text-dark-text shrink-0 w-28">
                    {FEATURE_LABELS[b.feature] || b.feature.replace(/_/g, ' ')}
                    <DirectionBadge feature={b.feature} />
                  </div>
                  <div className="flex-1 h-2.5 bg-line/40 dark:bg-dark-border rounded-full overflow-hidden ring-1 ring-inset ring-line/60 dark:ring-dark-border">
                    <div
                      className="h-full rounded-full transition-[width] duration-700 ease-out min-w-[6px]"
                      style={{ width: `${Math.max(barPct, 2)}%`, background: barColor }}
                    />
                  </div>
                  <div className="text-xs font-mono text-ink/70 dark:text-dark-muted w-16 text-right shrink-0">
                    {b.value}
                  </div>
                  <div className={`text-xs font-mono font-semibold w-16 text-right shrink-0 ${b.impact >= 0 ? 'text-success' : 'text-danger'}`}>
                    {b.impact >= 0 ? '+' : ''}{b.impact?.toFixed(1) ?? '0.0'}
                  </div>
                </div>
                <p className="text-[11px] text-ink/65 dark:text-dark-muted leading-snug mt-1 ml-[7.5rem] pr-32">
                  {plainLanguageInsight(b.feature, b.value, b.healthy_range, b.impact)}
                </p>
              </div>
            )
          })}
          {breakdown.length === 0 && <p className="text-sm text-ink/70 dark:text-dark-muted">No score breakdown available yet for this subject.</p>}
        </div>
      </Accordion>

      {/* The unsupervised model's per-feature anomaly drivers — distance from
          nearest GMM component mean, the actual quantity behind the risk
          score shown on this subject's header. Default-open since this is
          what actually explains the number and label now shown, unlike the
          Heart Health Score breakdown above, which is a separate (still
          label-free) reference-range view. */}
      {driverChartData.length > 0 && (
        <Accordion
          title="Risk score explainability (unsupervised model)"
          icon={Activity}
          defaultOpen
          badge={data.risk_assessment?.risk_score != null && (
            <span className="text-xs font-mono font-semibold text-brand-red shrink-0">
              {formatScore(data.risk_assessment.risk_score)}
              {data.risk_assessment.predicted_class ? ` · ${data.risk_assessment.predicted_class}` : ''}
            </span>
          )}
        >
          <p className="text-xs text-ink/75 dark:text-dark-muted mb-3 flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            How far each biomarker sits from this subject's nearest cluster center in the fitted
            Gaussian Mixture Model — the actual quantity driving the risk score, computed with no
            clinician labels involved.
          </p>
          <ResponsiveContainer width="100%" height={Math.max(160, driverChartData.length * 36)}>
            <BarChart data={driverChartData} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.3} />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="feature" width={110} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v, name, props) => [props.payload.signed.toFixed(2), 'signed contribution']} />
              <Bar dataKey="magnitude" radius={[0, 4, 4, 0]} isAnimationActive animationDuration={600} animationEasing="ease-out">
                {driverChartData.map((d, i) => (
                  <Cell key={i} fill={d.signed >= 0 ? '#CF0A0A' : '#2F8F5B'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Accordion>
      )}

      {/* NEW: model-quality context, not a headline viz — internal validation
          metrics for the unsupervised pipeline (silhouette, DB index, bootstrap
          stability). No labels/accuracy here since there's no ground truth. */}
      {validation && !validation.error && (
        <Accordion title="Model quality (internal validation)" icon={Activity}>
          <div className="flex flex-wrap gap-2 text-[11px]">
            {validation.cluster_quality?.silhouette_score != null && (
              <span className="px-2.5 py-1 rounded-full bg-line/40 dark:bg-dark-border text-ink/70 dark:text-dark-muted">
                Silhouette {validation.cluster_quality.silhouette_score}
              </span>
            )}
            {validation.cluster_quality?.davies_bouldin_score != null && (
              <span className="px-2.5 py-1 rounded-full bg-line/40 dark:bg-dark-border text-ink/70 dark:text-dark-muted">
                Davies-Bouldin {validation.cluster_quality.davies_bouldin_score}
              </span>
            )}
            {validation.bootstrap_stability?.mean_flip_rate != null && (
              <span className="px-2.5 py-1 rounded-full bg-line/40 dark:bg-dark-border text-ink/70 dark:text-dark-muted">
                Bootstrap flip rate {(validation.bootstrap_stability.mean_flip_rate * 100).toFixed(1)}%
              </span>
            )}
          </div>
          <p className="text-[11px] text-ink/65 dark:text-dark-muted mt-2">
            Derived, not diagnosed — structural properties of the clustering itself, computed without clinician labels.
          </p>
        </Accordion>
      )}
    </div>
  )
}