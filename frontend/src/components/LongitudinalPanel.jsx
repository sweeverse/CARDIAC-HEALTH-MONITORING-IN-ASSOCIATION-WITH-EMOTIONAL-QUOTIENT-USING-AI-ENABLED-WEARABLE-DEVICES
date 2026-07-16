import { useEffect, useState } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceArea,
} from 'recharts'
import { Loader2, TrendingUp, TrendingDown, Minus, Info, ArrowRight } from 'lucide-react'
import { Endpoints } from '../lib/api.js'
import { onDataChanged } from '../lib/syncBus.js'
import { formatScore } from '../lib/format.js'

const TREND_UI = {
  improving: { icon: TrendingUp, color: 'text-success', label: 'Improving' },
  declining: { icon: TrendingDown, color: 'text-danger', label: 'Declining' },
  stable: { icon: Minus, color: 'text-ink/75 dark:text-dark-muted', label: 'Stable' },
}

// Palette cycled per distinct recording session (session_batch_id) — every
// activity recorded together in the same sitting shares one of these colors,
// so a "session" reads as one color across up to 4 points, and the NEXT
// session (a different day/upload) gets a visually distinct color.
const SESSION_PALETTE = ['#CF0A0A', '#0E4F4A', '#DC5F00', '#2F7B73', '#C8401E', '#1A5C55', '#7FB3AA', '#F2855F']

// Activity is still shown, but as a MARKER SHAPE rather than a color, since
// color now encodes which session a point belongs to.
const ACTIVITY_SHAPES = { sit: 'circle', walk: 'square', run: 'triangle', cog: 'diamond' }
const ACTIVITY_LABELS = { sit: 'Sit', walk: 'Walk', run: 'Run', cog: 'Cognitive task' }

const ACTIVITY_INSIGHT = {
  improving: 'ML Risk Scores are trending downward across sessions — a positive indicator of improving cardiovascular fitness or reduced stress load over time.',
  declining: 'ML Risk Scores are trending upward across sessions. This may reflect accumulated fatigue, increasing stress, or worsening cardiovascular markers. Review the time-series tab for the specific biomarkers that are changing.',
  stable: 'ML Risk Scores are relatively stable across sessions — the subject\'s cardiovascular profile is consistent. Stability is normal; improvement typically requires targeted lifestyle or activity changes.',
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// Renders the point as a shape matching its activity, colored by its session.
function ActivityDot(color) {
  return (props) => {
    const act = props.payload?.activity
    const shape = ACTIVITY_SHAPES[act] || 'circle'
    const { cx, cy } = props
    const common = { stroke: '#fff', strokeWidth: 1.5, fill: color }
    if (shape === 'square') return <rect key={props.key} x={cx - 4} y={cy - 4} width={8} height={8} {...common} />
    if (shape === 'triangle') return <polygon key={props.key} points={`${cx},${cy - 5} ${cx - 5},${cy + 4} ${cx + 5},${cy + 4}`} {...common} />
    if (shape === 'diamond') return <polygon key={props.key} points={`${cx},${cy - 5} ${cx + 5},${cy} ${cx},${cy + 5} ${cx - 5},${cy}`} {...common} />
    return <circle key={props.key} cx={cx} cy={cy} r={4} {...common} />
  }
}

export default function LongitudinalPanel({ subjectId }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true); setError('')
    Endpoints.getLongitudinal(subjectId)
      .then((res) => setData(res.data))
      .catch(() => setError('Not enough session history yet to compute a longitudinal trend.'))
      .finally(() => setLoading(false))
  }, [subjectId])

  useEffect(() => {
    return onDataChanged(() => {
      Endpoints.getLongitudinal(subjectId).then((res) => setData(res.data)).catch(() => {})
    })
  }, [subjectId])

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-brand-red" /></div>
  if (error) return <div className="card p-6 text-sm text-ink/80 dark:text-dark-muted">{error}</div>
  if (!data) return null

  const trend = TREND_UI[data.trend] || TREND_UI.stable
  const TrendIcon = trend.icon

  const chronological = [...data.timeline]
    .sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at))
    .map((t, i) => ({ ...t, seq: i + 1, dateLabel: fmtDate(t.recorded_at) }))

  // Assign each distinct session_batch_id a color, in the order it first
  // appears chronologically, so "Session 1" is always the earliest.
  const sessionOrder = []
  chronological.forEach((t) => {
    if (!sessionOrder.includes(t.session_batch_id)) sessionOrder.push(t.session_batch_id)
  })
  const sessionColor = Object.fromEntries(
    sessionOrder.map((id, i) => [id, SESSION_PALETTE[i % SESSION_PALETTE.length]])
  )
  const sessionLabel = Object.fromEntries(sessionOrder.map((id, i) => [id, `Session ${i + 1}`]))

  // One background band per session, spanning from its first to last point's
  // x-category, tinted with that session's color at low opacity — makes
  // "these 4 points are one recording session" obvious at a glance even
  // before reading colors/shapes.
  const sessionBands = sessionOrder.map((id) => {
    const pts = chronological.filter((t) => t.session_batch_id === id)
    return {
      id,
      color: sessionColor[id],
      x1: pts[0].dateLabel,
      x2: pts[pts.length - 1].dateLabel,
    }
  })

  return (
    <div className="space-y-5">
      {/* Trend header — only shown once this subject has the SAME activity
          recorded on two different occasions; otherwise there's nothing
          real to compare yet. */}
      {data.has_qualifying_trend ? (
        <div className="card p-5 flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full bg-paper dark:bg-dark-surface flex items-center justify-center ${trend.color}`}>
            <TrendIcon className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-bold text-ink/80 dark:text-dark-text">Overall trend: <span className={trend.color}>{trend.label}</span></p>
            <p className="text-xs text-ink/70 dark:text-dark-muted">Comparing repeated activities across {data.timeline.length} recorded sessions, in chronological order</p>
          </div>
        </div>
      ) : (
        <div className="card p-4 border border-warning/25 bg-warning/5 text-xs text-ink/65 dark:text-dark-muted flex items-start gap-2">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-warning" />
          No trend yet — this subject doesn't have the same activity recorded on two different
          occasions. Record the same activity again at a later time to start tracking change.
        </div>
      )}

      {/* Main longitudinal chart */}
      <div className="card p-5">
        <h3 className="font-display font-semibold text-base mb-1 dark:text-dark-text">ML Risk Score over time</h3>
        <p className="text-xs text-ink/75 dark:text-dark-muted mb-4">
          Every recorded session, in the order it happened — same metric that drives the risk label (lower is
          better). Color + shaded background = which recording session a point belongs to (all activities done in
          one sitting share a color); marker shape = which activity.
        </p>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={chronological} margin={{ left: -16, right: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E6E1D3" />
            {sessionBands.map((b) => (
              <ReferenceArea key={b.id} x1={b.x1} x2={b.x2} fill={b.color} fillOpacity={0.08} stroke={b.color} strokeOpacity={0.25} />
            ))}
            <XAxis dataKey="dateLabel" tick={{ fontSize: 11, fill: '#0F242199' }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#0F242199' }} />
            <Tooltip
              contentStyle={{ borderRadius: 10, border: '1px solid #DCD6C7', fontSize: 12 }}
              formatter={(v, n, p) => [
                v?.toFixed?.(1) ?? v,
                `Risk score (${ACTIVITY_LABELS[p.payload.activity] || p.payload.activity}) · ${sessionLabel[p.payload.session_batch_id] || ''}`,
              ]}
            />
            <Line
              type="monotone" dataKey="avg_risk_score" stroke="#94a3b8" strokeWidth={1.5} strokeOpacity={0.5}
              dot={(props) => ActivityDot(sessionColor[props.payload?.session_batch_id] || '#CF0A0A')(props)}
              activeDot={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>

        {/* Two separate legends: which SESSION (color) vs which ACTIVITY (shape) */}
        <div className="flex flex-wrap gap-x-6 gap-y-2 mt-3 pt-3 border-t border-line/50 dark:border-dark-border">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-ink/65 dark:text-dark-muted font-semibold mb-1">Session (color)</p>
            <div className="flex items-center gap-3 flex-wrap">
              {sessionOrder.map((id) => (
                <span key={id} className="flex items-center gap-1.5 text-xs text-ink/60 dark:text-dark-muted">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: sessionColor[id] }} />
                  {sessionLabel[id]}
                </span>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-ink/65 dark:text-dark-muted font-semibold mb-1">Activity (shape)</p>
            <div className="flex items-center gap-3 flex-wrap">
              {Object.entries(ACTIVITY_LABELS).map(([act, label]) => (
                <span key={act} className="flex items-center gap-1.5 text-xs text-ink/60 dark:text-dark-muted">
                  <ShapeIcon shape={ACTIVITY_SHAPES[act]} /> {label}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Insight below graph */}
        {data.has_qualifying_trend && (
          <div className="mt-4 p-3 bg-paper dark:bg-dark-surface border border-line/60 dark:border-dark-border rounded-lg">
            <div className="flex items-start gap-1.5">
              <ArrowRight className="w-3 h-3 mt-0.5 shrink-0 text-brand-red" />
              <p className="text-[11px] text-ink/60 dark:text-dark-muted leading-relaxed">
                <strong className="text-ink/80 dark:text-dark-text">{trend.label} trend:</strong>{' '}
                {ACTIVITY_INSIGHT[data.trend] || ACTIVITY_INSIGHT.stable}
                {' '}{thresholdsBlurb(data.bucket_thresholds)}
                Different activities have different baselines — a Run session's risk score typically differs from a Sit
                session's due to physiological stress, so each activity here is only ever compared against its own past occasions.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Session-wise list — every recorded session in order, each with its
          own comparison against the last time this same activity was recorded
          (not bucketed/summarized by activity type). */}
      <div className="space-y-2">
        {chronological.map((t) => {
          const hasDelta = t.delta_from_previous_same_activity != null
          const deltaTrend = TREND_UI[t.trend_vs_previous] || null
          const DeltaIcon = deltaTrend?.icon
          return (
            <div key={t.session_id} className="card p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: sessionColor[t.session_batch_id] }} />
                <div>
                  <p className="text-sm font-bold text-ink/80 dark:text-dark-text capitalize">
                    {ACTIVITY_LABELS[t.activity] || t.activity} <span className="font-normal text-ink/65 dark:text-dark-muted">— {t.dateLabel} · {sessionLabel[t.session_batch_id]}</span>
                  </p>
                  <p className="text-xs text-ink/70 dark:text-dark-muted">Risk {formatScore(t.avg_risk_score)} · HR {fmt(t.avg_heart_rate)} bpm · RMSSD {fmt(t.avg_rmssd)} ms</p>
                </div>
              </div>
              {hasDelta ? (
                <div className={`flex items-center gap-1.5 text-xs font-semibold shrink-0 ${deltaTrend.color}`}>
                  <DeltaIcon className="w-3.5 h-3.5" />
                  {t.delta_from_previous_same_activity > 0 ? '+' : ''}{t.delta_from_previous_same_activity} pts vs last {t.activity === 'cog' ? 'cognitive' : t.activity} session
                </div>
              ) : (
                <span className="text-xs text-ink/60 dark:text-dark-muted shrink-0">First recorded {t.activity === 'cog' ? 'cognitive' : t.activity} session</span>
              )}
            </div>
          )
        })}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-paper dark:bg-dark-surface text-xs uppercase tracking-wide text-ink/70 dark:text-dark-muted">
            <tr>
              <th className="text-left px-4 py-2.5 font-semibold">Date</th>
              <th className="text-left px-4 py-2.5 font-semibold">Session</th>
              <th className="text-left px-4 py-2.5 font-semibold">Activity</th>
              <th className="text-right px-4 py-2.5 font-semibold">Avg HR</th>
              <th className="text-right px-4 py-2.5 font-semibold">Avg RMSSD</th>
              <th className="text-right px-4 py-2.5 font-semibold">Avg Stress</th>
              <th className="text-right px-4 py-2.5 font-semibold">Risk Score</th>
            </tr>
          </thead>
          <tbody>
            {chronological.map((t, i) => (
              <tr key={i} className="border-t border-line/60 dark:border-dark-border">
                <td className="px-4 py-2.5 text-ink/80 dark:text-dark-muted font-mono text-xs">{t.dateLabel}</td>
                <td className="px-4 py-2.5 text-xs">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ background: sessionColor[t.session_batch_id] }} />
                    {sessionLabel[t.session_batch_id]}
                  </span>
                </td>
                <td className="px-4 py-2.5 capitalize font-medium dark:text-dark-text">{t.activity}</td>
                <td className="px-4 py-2.5 text-right font-mono text-ink/65 dark:text-dark-muted">{fmt(t.avg_heart_rate)}</td>
                <td className="px-4 py-2.5 text-right font-mono text-ink/65 dark:text-dark-muted">{fmt(t.avg_rmssd)}</td>
                <td className="px-4 py-2.5 text-right font-mono text-ink/65 dark:text-dark-muted">{fmt(t.avg_stress_index)}</td>
                <td className="px-4 py-2.5 text-right font-mono font-semibold text-brand-red">{formatScore(t.avg_risk_score)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ShapeIcon({ shape }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }
  if (shape === 'square') return <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" {...common} /></svg>
  if (shape === 'triangle') return <svg width="10" height="10" viewBox="0 0 10 10"><polygon points="5,1 9,9 1,9" {...common} /></svg>
  if (shape === 'diamond') return <svg width="10" height="10" viewBox="0 0 10 10"><polygon points="5,1 9,5 5,9 1,5" {...common} /></svg>
  return <svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" {...common} /></svg>
}

function fmt(v) { return v != null ? v.toFixed(1) : '—' }

// Bucket cutoffs are cohort-relative and refit on every recalibration
// (see services/retrain.py) — never hardcode "65/45" here, or this text
// silently drifts from whatever the model is actually using.
function thresholdsBlurb(thresholds) {
  if (!thresholds?.mild_risk_at || !thresholds?.moderate_risk_at) {
    return 'A lower ML Risk Score is healthier; higher scores indicate greater deviation from the cohort norm.'
  }
  return `An ML Risk Score below ${thresholds.mild_risk_at} is considered healthy; ${thresholds.mild_risk_at}–${thresholds.moderate_risk_at} is mild risk; above ${thresholds.moderate_risk_at} is moderate risk (cohort-relative, recalculated on every recalibration).`
}
