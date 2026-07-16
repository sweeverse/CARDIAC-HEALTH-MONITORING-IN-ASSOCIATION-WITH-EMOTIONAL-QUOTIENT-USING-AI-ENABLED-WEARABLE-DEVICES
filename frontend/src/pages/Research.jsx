import { Component, useEffect, useMemo, useState } from 'react'
import {
  ComposedChart, Scatter, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { Info, Loader2, HeartPulse, Grid3x3, ClipboardCheck, LineChart } from 'lucide-react'
import { Endpoints } from '../lib/api.js'
import { formatSubjectId } from '../lib/subjectId.js'
import { onDataChanged } from '../lib/syncBus.js'
import { useAuth } from '../context/AuthContext.jsx'

const FEATURE_LABELS = {
  heart_rate: 'Heart Rate', rr_interval_ms: 'RR Interval', rmssd: 'RMSSD',
  sdnn: 'SDNN', stress_index: 'Stress Index', recovery_rate: 'Recovery Rate',
  motion_intensity: 'Motion Intensity', bmi: 'BMI', age: 'Age',
}
const ACTIVITY_LABELS = { sit: 'Sit', walk: 'Walk', run: 'Run', cog: 'Cognitive Task' }

export default function Research() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [eqCardiac, setEqCardiac] = useState(null)
  const [refRanges, setRefRanges] = useState(null)
  const [loading, setLoading] = useState(true)
  const [highlightSubject, setHighlightSubject] = useState('')
  const [subjectSummary, setSubjectSummary] = useState(null)
  // Broken into three sub-pages within EQ Research (graphs / correlation
  // matrix / conclusion) instead of one long scroll — each tab renders
  // independently off the same already-fetched eqCardiac + refRanges data,
  // so switching tabs is instant with no extra network round-trip.
  const [tab, setTab] = useState('graphs')

  useEffect(() => {
    Promise.allSettled([
      Endpoints.getEqCardiacCorrelation(),
      Endpoints.getReferenceRangesByActivity(),
    ]).then(([eq, rr]) => {
      if (eq.status === 'fulfilled') setEqCardiac(eq.value.data)
      if (rr.status === 'fulfilled') setRefRanges(rr.value.data)
    }).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    return onDataChanged(() => {
      Promise.allSettled([
        Endpoints.getEqCardiacCorrelation(),
        Endpoints.getReferenceRangesByActivity(),
      ]).then(([eq, rr]) => {
        if (eq.status === 'fulfilled') setEqCardiac(eq.value.data)
        if (rr.status === 'fulfilled') setRefRanges(rr.value.data)
      })
    })
  }, [])

  // Subject login: the Research Graph and the overall conclusion are always
  // about THAT subject's own data — there's no cohort dropdown to pick from,
  // it's just automatically them. Admin login: the dropdown drives which
  // subject the conclusion is for, and re-picks it any time the selection
  // changes (handled below by the effect keying off highlightSubject).
  useEffect(() => {
    if (!isAdmin && user?.subject_id) setHighlightSubject(user.subject_id)
  }, [isAdmin, user?.subject_id])

  // Whenever the highlighted subject changes (admin picks a new one from the
  // dropdown, or a non-admin's own id loads in) fetch that subject's own
  // health summary — heart health score, risk class, demographics — so the
  // overall conclusion at the end of the page can speak to their actual
  // physiological assessment, not just the EQ-correlation scatter values.
  useEffect(() => {
    if (!highlightSubject) { setSubjectSummary(null); return }
    let cancelled = false
    Endpoints.getSubject(highlightSubject)
      .then((res) => { if (!cancelled) setSubjectSummary(res.data) })
      .catch(() => { if (!cancelled) setSubjectSummary(null) })
    return () => { cancelled = true }
  }, [highlightSubject])

  return (
    <div className="space-y-6">
      <p className="text-sm text-ink/80 dark:text-dark-muted -mt-2">
        How Emotional Intelligence relates to cardiovascular health across this cohort, plus model-validation
        research tools. (The EQ questionnaire itself now lives in the Upload Recording flow and, for existing
        subjects, the per-subject Retake option — see Admin EQ Management to backfill a baseline.)
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-brand-red" /></div>
      ) : (
        <>
          <div className="flex items-center gap-1.5 border-b border-line/70 dark:border-dark-border">
            {[
              { id: 'graphs', label: 'Graphs', icon: LineChart },
              { id: 'matrix', label: 'Correlation matrix', icon: Grid3x3 },
              { id: 'conclusion', label: 'Conclusion', icon: ClipboardCheck },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  tab === t.id
                    ? 'border-brand-red text-brand-red'
                    : 'border-transparent text-ink/80 dark:text-dark-muted hover:text-ink/80 dark:hover:text-dark-text'
                }`}
              >
                <t.icon className="w-3.5 h-3.5" /> {t.label}
              </button>
            ))}
          </div>

          {tab === 'graphs' && (
            <>
              <CardErrorBoundary>
                <EqCardiacDashboard
                  data={eqCardiac}
                  highlightSubject={highlightSubject}
                  setHighlightSubject={setHighlightSubject}
                  isAdmin={isAdmin}
                />
              </CardErrorBoundary>
              <CardErrorBoundary>
                <ReferenceRangesCard data={refRanges} />
              </CardErrorBoundary>
            </>
          )}
          {tab === 'matrix' && (
            <CardErrorBoundary>
              {eqCardiac?.insufficient_data
                ? <Card title="Correlation matrix — EQ score & cardiac metrics" icon={Grid3x3}><InsufficientData>{eqCardiac.message}</InsufficientData></Card>
                : <CorrelationMatrix matrix={eqCardiac?.correlation_matrix} />}
            </CardErrorBoundary>
          )}
          {tab === 'conclusion' && (
            <CardErrorBoundary>
              <OverallConclusion data={eqCardiac} highlightSubject={highlightSubject} subjectSummary={subjectSummary} isAdmin={isAdmin} />
            </CardErrorBoundary>
          )}
        </>
      )}
    </div>
  )
}

function Card({ title, icon: Icon, children, delay = 0 }) {
  return (
    <div className="card p-5 chart-card-enter" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center gap-2 mb-4">
        {Icon && <Icon className="w-4 h-4 text-brand-red" />}
        <h3 className="font-display font-semibold text-base dark:text-dark-text">{title}</h3>
      </div>
      {children}
    </div>
  )
}

// Small local error boundary so one malformed metric/subject can't take down
// the whole Research page — it degrades to a single card-level message
// instead of the entire tab (or app) crashing.
class CardErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false } }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch(error, info) { console.error('CardioEQ AI — Research card error:', error, info) }
  render() {
    if (this.state.hasError) {
      return (
        <div className="card p-5">
          <InsufficientData>This section couldn't be rendered due to unexpected data. Other sections are unaffected.</InsufficientData>
        </div>
      )
    }
    return this.props.children
  }
}

// Safe helper for displaying a mean/aggregate — never lets a non-finite
// number (NaN/undefined from an empty or malformed points array) reach
// .toFixed() and throw.
function safeFixed(n, digits = 1) {
  return Number.isFinite(n) ? n.toFixed(digits) : 'n/a'
}

function InsufficientData({ children }) {
  return (
    <div className="flex items-start gap-2 text-sm text-ink/60 dark:text-dark-muted bg-paper dark:bg-dark-surface border border-line dark:border-dark-border rounded-lg p-3">
      <Info className="w-4 h-4 mt-0.5 shrink-0 text-warning" />
      <span>{children}</span>
    </div>
  )
}

// --- EQ vs. cardiac health: per-metric scatter + regression, plus a
// cohort-wide correlation matrix. Fully data-driven off /eq-cardiac-correlation
// (Task 14-18) — nothing here is hardcoded; it re-renders from whatever's
// actually in Mongo on every page load.
function EqCardiacDashboard({ data, highlightSubject, setHighlightSubject, isAdmin }) {
  if (!data) return null

  if (data.insufficient_data) {
    return (
      <Card title="EQ vs. cardiovascular health" icon={HeartPulse}>
        <InsufficientData>{data.message}</InsufficientData>
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      <div className="card p-4 flex items-center justify-between gap-4 flex-wrap">
        <p className="text-xs text-ink/80 dark:text-dark-muted">
          Analyzing <strong className="text-ink/80 dark:text-dark-text">{data.n_eligible_subjects}</strong> subjects
          with both a completed EQ questionnaire and at least one recorded session.
        </p>
        {isAdmin ? (
          <label className="flex items-center gap-2 text-xs text-ink/80 dark:text-dark-muted">
            Subject:
            <select
              className="input-field !py-1.5 !text-xs w-32"
              value={highlightSubject}
              onChange={(e) => setHighlightSubject(e.target.value)}
            >
              <option value="">None (all gray)</option>
              {data.eligible_subject_ids.map((sid) => (
                <option key={sid} value={sid}>{formatSubjectId(sid)}</option>
              ))}
            </select>
          </label>
        ) : highlightSubject && data.eligible_subject_ids.includes(highlightSubject) ? (
          <span className="pill bg-brand-red/10 text-brand-red border border-brand-red/20 text-xs">
            Showing your data — {formatSubjectId(highlightSubject)}
          </span>
        ) : null}
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {data.analyses.map((a, i) => (
          <CardErrorBoundary key={a.metric_key}>
            <EqMetricScatter analysis={a} highlightSubject={highlightSubject} delay={i * 90} />
          </CardErrorBoundary>
        ))}
      </div>
    </div>
  )
}

function EqMetricScatter({ analysis: a, highlightSubject, delay = 0 }) {
  // Guard every field this component touches unconditionally (i.e. before
  // the insufficientForMetric branch even runs) — metric_label was being
  // read with `.toLowerCase()` and unit with `.trim()` assuming the API
  // always sends a string. Any one metric coming back missing/renamed
  // (schema drift, a partially-migrated record, etc.) threw here and the
  // CardErrorBoundary above swallowed it into the generic "couldn't be
  // rendered" message — for every card at once if it affected all of them.
  // Falling back instead keeps the chart rendering with an honest label.
  const metricLabel = typeof a?.metric_label === 'string' && a.metric_label ? a.metric_label : (a?.metric_key || 'metric')
  const unit = typeof a?.unit === 'string' ? a.unit : ''
  const n = Number.isFinite(a?.n) ? a.n : 0
  const insufficientForMetric = n < 3 || a?.r == null
  const [hoveredId, setHoveredId] = useState(null)
  const gradId = `pt-grad-${a?.metric_key ?? 'x'}`
  const lineGradId = `line-grad-${a?.metric_key ?? 'x'}`

  const points = (a.points || []).map((p) => ({ ...p, isHighlighted: p.subject_id === highlightSubject }))
  // The best-fit line was previously drawn across the FULL 0-100 EQ-score
  // axis regardless of where the actual data points sit. With only a
  // handful of subjects clustered in a narrow EQ range, extrapolating the
  // line out to eq_score=0 and eq_score=100 projected wildly out-of-range Y
  // values that rendered outside the chart's plot area entirely (the lines
  // seen shooting past the box edges). Drawing it only across the observed
  // eq_score range keeps it a fair visual summary of the actual data
  // instead of an extrapolation, and keeps it inside the chart.
  const eqScores = points.map((p) => p.eq_score).filter((v) => Number.isFinite(v))
  const rawMin = eqScores.length ? Math.min(...eqScores) : 0
  const rawMax = eqScores.length ? Math.max(...eqScores) : 100
  // Pad the line a bit past the observed data on each side (instead of
  // stopping exactly at the min/max point) so it reads as a proper trend
  // line rather than a short segment barely connecting the outermost dots.
  // Still clamped to the real [0,100] EQ-score domain, so it never
  // extrapolates wildly off-chart the way the original full-axis version did.
  //
  // BOTH lineXMin and lineXMax get clamped to BOTH ends of [0,100] here —
  // clamping each only on its "own" side (min only at 0, max only at 100)
  // meant an eq_score that ever fell outside that assumed range (bad
  // record, questionnaire edge case) could leave lineXMin sitting ABOVE
  // lineXMax once the max side got clamped down to 100 but the min side
  // didn't. That inverted range fed straight into the XAxis's fixed
  // [min, max] domain below, which is exactly what makes recharts' tick
  // generator throw ("DecimalError: Invalid argument: NaN") instead of
  // just clipping the line quietly.
  const span = Math.max(rawMax - rawMin, 1)
  const pad = Math.max(span * 0.12, 2)
  const lineXMin = Math.min(100, Math.max(0, rawMin - pad))
  const lineXMax = Math.max(0, Math.min(100, rawMax + pad))

  // Y-axis domain, sized off the REAL data points only — never off the
  // regression line's own fit values. A steep slope (common with n this
  // small) can send the line's fit far past the actual point range; if the
  // axis stretched to include that, the axis itself would balloon and the
  // line would still often end up touching/crossing the plot's own top or
  // bottom edge depending on rounding. Fixing the Y range to the real data
  // (+ margin) instead, then clipping the line into it below, guarantees
  // the line can never visually escape the box.
  const values = points.map((p) => p.value).filter((v) => Number.isFinite(v))
  const yRawMin = values.length ? Math.min(...values) : 0
  const yRawMax = values.length ? Math.max(...values) : 1
  const yMargin = Math.max((yRawMax - yRawMin) * 0.12, 1)
  let yAxisMin = Math.floor(yRawMin - yMargin)
  let yAxisMax = Math.ceil(yRawMax + yMargin)
  if (!Number.isFinite(yAxisMin)) yAxisMin = 0
  if (!Number.isFinite(yAxisMax)) yAxisMax = 1
  if (yAxisMin > yAxisMax) { const t = yAxisMin; yAxisMin = yAxisMax; yAxisMax = t }
  if (yAxisMax - yAxisMin < 1) yAxisMax = yAxisMin + 1

  // Straight line, clipped (not clamped) to the axis box. The old approach
  // sampled 12 points across the line's X range and clamped each point's Y
  // independently — with a steep slope, different sample points hit the
  // ceiling/floor at different X positions, which bent the "line" into a
  // visibly kinked curve instead of a straight regression line.
  // Fix: keep it a true 2-point straight segment. Where that segment would
  // exit the Y range, shorten it by moving the X endpoint inward (standard
  // line-clipping) so it still stops exactly at the box edge — never
  // clamps Y flat, never bends, never crosses the axis.
  const clipLineToBox = (x0, y0, x1, y1, yMin, yMax) => {
    let t0 = 0, t1 = 1
    const dy = y1 - y0
    if (dy !== 0) {
      const tA = (yMin - y0) / dy
      const tB = (yMax - y0) / dy
      t0 = Math.max(t0, Math.min(tA, tB))
      t1 = Math.min(t1, Math.max(tA, tB))
    } else if (y0 < yMin || y0 > yMax) {
      return null // flat line fully outside the box
    }
    if (t0 > t1) return null // segment fully clipped away
    return {
      x0: x0 + (x1 - x0) * t0, y0: y0 + dy * t0,
      x1: x0 + (x1 - x0) * t1, y1: y0 + dy * t1,
    }
  }

  let regressionLine = []
  if (a.regression) {
    const rawY0 = a.regression.slope * lineXMin + a.regression.intercept
    const rawY1 = a.regression.slope * lineXMax + a.regression.intercept
    const clipped = clipLineToBox(lineXMin, rawY0, lineXMax, rawY1, yAxisMin, yAxisMax)
    if (clipped) {
      regressionLine = [
        { eq_score: clipped.x0, fit: clipped.y0 },
        { eq_score: clipped.x1, fit: clipped.y1 },
      ]
    }
  }

  // The X AXIS itself used to always span the full fixed 0-100 EQ scale
  // regardless of where the line/points actually sit — with real
  // responses usually clustered in a narrow band (e.g. 45-55), the line
  // above was correctly computed but still only occupied a sliver of a
  // chart that was 10x wider than it needed to be. Sizing the axis off
  // the line's OWN range instead — with a fixed margin on each side —
  // makes the line consistently fill a fixed % of the plot width
  // (line width ÷ (line width + 2 × margin%) ) no matter how small or
  // tightly-clustered the dataset is, while every point (a subset of the
  // already-padded line range) still always fits inside it. 0.45 here
  // means the line fills line/(line+0.9·line) ≈ 53% of the plot width —
  // bumped up from the original 0.125 (80% fill) so the line reads
  // visibly shorter/smaller against the chart.
  const lineSpan = Math.max(lineXMax - lineXMin, 1)
  const axisMargin = lineSpan * 0.45
  let xAxisMin = Math.max(0, Math.floor(lineXMin - axisMargin))
  let xAxisMax = Math.min(100, Math.ceil(lineXMax + axisMargin))
  // Last-resort guard: whatever the arithmetic above produces, recharts'
  // fixed-domain tick generator will hard-crash the whole chart (not just
  // show a blank axis) on a non-finite or inverted/zero-width [min, max]
  // pair, so never hand it one.
  if (!Number.isFinite(xAxisMin)) xAxisMin = 0
  if (!Number.isFinite(xAxisMax)) xAxisMax = 100
  if (xAxisMin > xAxisMax) { const t = xAxisMin; xAxisMin = xAxisMax; xAxisMax = t }
  if (xAxisMax - xAxisMin < 1) xAxisMax = xAxisMin + 1

  return (
    <Card title={`EQ vs. ${metricLabel}`} icon={HeartPulse} delay={delay}>
      <p className="text-xs text-ink/75 dark:text-dark-muted mb-3">
        Each point is one subject's self-reported EQ score against their {metricLabel.toLowerCase()}
        {unit ? ` (${unit.trim()})` : ''}, averaged across their recorded sessions. n = {n} subjects.
      </p>

      {insufficientForMetric ? (
        <InsufficientData>Not enough subjects with both values yet (n = {n}) for a meaningful correlation.</InsufficientData>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart margin={{ top: 10, right: 16, bottom: 24, left: 4 }}>
              <defs>
                <radialGradient id={gradId} cx="35%" cy="35%" r="65%">
                  <stop offset="0%" stopColor="#FF6B5C" />
                  <stop offset="100%" stopColor="#CF0A0A" />
                </radialGradient>
                <radialGradient id={`${gradId}-other`} cx="35%" cy="35%" r="65%">
                  <stop offset="0%" stopColor="#B9C4D4" />
                  <stop offset="100%" stopColor="#7C8CA3" />
                </radialGradient>
                <linearGradient id={lineGradId} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#0E4F4A" stopOpacity={0.35} />
                  <stop offset="50%" stopColor="#12726B" stopOpacity={0.95} />
                  <stop offset="100%" stopColor="#0E4F4A" stopOpacity={0.35} />
                </linearGradient>
                <filter id={`${gradId}-shadow`} x="-60%" y="-60%" width="220%" height="220%">
                  <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" floodColor="#CF0A0A" floodOpacity="0.35" />
                </filter>
              </defs>
              <CartesianGrid stroke="#E6E1D3" strokeDasharray="2 4" />
              <XAxis
                type="number" dataKey="eq_score" name="EQ score" domain={[xAxisMin, xAxisMax]} tick={{ fontSize: 10 }}
                label={{ value: 'Self-reported EQ score', position: 'bottom', fontSize: 10, offset: 0 }}
              />
              <YAxis
                type="number" dataKey="value" name={metricLabel} tick={{ fontSize: 10 }}
                domain={[yAxisMin, yAxisMax]}
                allowDataOverflow
                label={{ value: `${metricLabel}${unit ? ` (${unit.trim()})` : ''}`, angle: -90, position: 'insideLeft', fontSize: 10 }}
              />
              <Tooltip
                cursor={{ strokeDasharray: '3 3', stroke: '#CF0A0A', strokeOpacity: 0.3 }}
                content={({ payload }) => {
                  const p = payload?.find((x) => x.dataKey === 'value')?.payload
                  if (!p) return null
                  return (
                    <div className="bg-white dark:bg-dark-card border border-line dark:border-dark-border rounded-lg px-3 py-2 text-xs shadow-pop">
                      <strong className={p.isHighlighted ? 'text-brand-red' : ''}>{formatSubjectId(p.subject_id)}</strong><br />
                      EQ: {p.eq_score} · {metricLabel}: {p.value}
                    </div>
                  )
                }}
              />
              <Line
                data={regressionLine} dataKey="fit" type="linear" stroke={`url(#${lineGradId})`} strokeWidth={3.5}
                dot={false} activeDot={false} legendType="none"
                isAnimationActive animationDuration={900} animationEasing="ease-out" animationBegin={150}
              />
              <Scatter
                data={points}
                dataKey="value"
                isAnimationActive
                animationDuration={800}
                animationEasing="ease-out"
                shape={(props) => {
                  const { cx, cy, payload } = props
                  const highlighted = payload.isHighlighted
                  const hovered = hoveredId === payload.subject_id
                  const r = highlighted ? (hovered ? 8 : 6.5) : (hovered ? 6 : 4.5)
                  return (
                    <g
                      onMouseEnter={() => setHoveredId(payload.subject_id)}
                      onMouseLeave={() => setHoveredId(null)}
                      style={{ cursor: 'pointer', transition: 'r 0.15s ease' }}
                    >
                      {highlighted && (
                        <circle cx={cx} cy={cy} r={r + 5} fill="#CF0A0A" fillOpacity={0.12} />
                      )}
                      <circle
                        cx={cx} cy={cy} r={r}
                        fill={highlighted ? `url(#${gradId})` : `url(#${gradId}-other)`}
                        fillOpacity={highlighted ? 1 : 0.85}
                        stroke="#fff"
                        strokeWidth={highlighted ? 2 : 1.5}
                        filter={highlighted ? `url(#${gradId}-shadow)` : undefined}
                      />
                    </g>
                  )
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>

          <div className="flex items-center gap-4 flex-wrap text-[11px] text-ink/80 dark:text-dark-muted mt-1 mb-3">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'linear-gradient(135deg, #B9C4D4, #7C8CA3)' }} /> Other subjects
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'linear-gradient(135deg, #FF6B5C, #CF0A0A)' }} /> Highlighted subject
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-[3px] rounded-full" style={{ background: 'linear-gradient(90deg, transparent, #12726B, transparent)' }} /> Best-fit line
            </span>
          </div>

          <div className="flex items-center gap-3 flex-wrap text-xs mb-2">
            <span className="font-mono font-semibold text-ink/80 dark:text-dark-text">r = {a.r}</span>
            <span className="text-ink/70 dark:text-dark-muted">
              {a.p_value != null ? `p = ${a.p_value}${a.p_value < 0.05 ? ' (significant at α=0.05)' : ' (not significant)'}` : 'p-value unavailable'}
            </span>
            <span className="text-ink/70 dark:text-dark-muted">n = {n}</span>
          </div>

          <p className="text-[11px] text-ink/80 dark:text-dark-muted leading-relaxed">
            {a.interpretation}
            {highlightSubject && points.find((p) => p.isHighlighted) && (
              <> {' '}<strong className="text-ink/70 dark:text-dark-text">{formatSubjectId(highlightSubject)}</strong> sits at
              EQ {points.find((p) => p.isHighlighted).eq_score}, {metricLabel.toLowerCase()} {points.find((p) => p.isHighlighted).value}
              {' '}— {a.points?.length ? (points.find((p) => p.isHighlighted).value >= (a.points.reduce((s, p) => s + (Number(p.value) || 0), 0) / a.points.length) ? 'above' : 'below') : 'at'} the cohort average.</>
            )}
          </p>
        </>
      )}
    </Card>
  )
}

function CorrelationMatrix({ matrix }) {
  if (!matrix) return null
  const { labels, matrix: rows } = matrix
  if (!Array.isArray(labels) || !Array.isArray(rows)) {
    return <Card title="Correlation matrix — EQ score & cardiac metrics" icon={Grid3x3}><InsufficientData>Correlation matrix data isn't in the expected shape yet.</InsufficientData></Card>
  }

  const cellStyle = (r) => {
    if (r == null) return { background: 'transparent', color: 'inherit' }
    const intensity = Math.min(Math.abs(r), 1)
    const bg = r > 0 ? `rgba(47,143,91,${0.15 + intensity * 0.55})` : `rgba(207,10,10,${0.15 + intensity * 0.55})`
    return { background: bg, color: intensity > 0.5 ? '#fff' : 'inherit' }
  }

  return (
    <Card title="Correlation matrix — EQ score & cardiac metrics" icon={Grid3x3}>
      <p className="text-xs text-ink/75 dark:text-dark-muted mb-4">
        Pairwise Pearson correlation across every metric below. Darker green = strong positive relationship;
        darker red = strong negative relationship; pale/blank = weak or not enough paired data.
      </p>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse">
          <thead>
            <tr>
              <th className="p-1.5"></th>
              {labels.map((l) => <th key={l} className="p-1.5 font-semibold text-ink/60 dark:text-dark-muted whitespace-nowrap">{l}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={labels[i]}>
                <th className="p-1.5 text-right font-semibold text-ink/60 dark:text-dark-muted whitespace-nowrap">{labels[i]}</th>
                {row.map((r, j) => (
                  <td key={j} className="p-1.5 text-center font-mono rounded" style={cellStyle(r)} title={`${labels[i]} × ${labels[j]}: r = ${r ?? 'n/a'}`}>
                    {r != null ? r.toFixed(2) : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// --- Overall conclusion (end of page): synthesizes across every EQ x
// cardiac-metric analysis PLUS the subject's own Heart Health Score / risk
// class into one plain-language cardiovascular & physiological assessment.
// Subject login: this is always about them, no picking required. Admin
// login: it re-derives automatically every time the dropdown selection
// changes, since it's computed straight from highlightSubject + live data.
function OverallConclusion({ data, highlightSubject, subjectSummary, isAdmin }) {
  const conclusion = useMemo(() => buildOverallConclusion(data, highlightSubject, subjectSummary), [data, highlightSubject, subjectSummary])

  return (
    <Card title="Overall conclusion" icon={ClipboardCheck}>
      {!highlightSubject ? (
        <InsufficientData>
          {isAdmin
            ? 'Pick a subject from the dropdown on the Graphs tab to generate their overall cardiovascular and physiological assessment.'
            : 'Your overall assessment will appear here once you have a completed EQ questionnaire and at least one recorded session.'}
        </InsufficientData>
      ) : !conclusion ? (
        <InsufficientData>
          {formatSubjectId(highlightSubject)} doesn't have enough recorded data yet (a completed EQ questionnaire
          and at least one session) to generate an overall conclusion.
        </InsufficientData>
      ) : (
        <div className="space-y-6">
          <p className="text-sm text-ink/80 dark:text-dark-text leading-relaxed">{conclusion.summary}</p>

          {conclusion.sections.map((sec, i) => (
            <div key={i} className="border-t border-line/60 dark:border-dark-border pt-4 first:border-t-0 first:pt-0">
              <p className="text-xs font-bold uppercase tracking-wide text-brand-red mb-1.5">{sec.heading}</p>
              <p className="text-sm text-ink/70 dark:text-dark-muted leading-relaxed">{sec.body}</p>
            </div>
          ))}

          {conclusion.bullets.length > 0 && (
            <div className="border-t border-line/60 dark:border-dark-border pt-4">
              <p className="text-xs font-bold uppercase tracking-wide text-ink/75 dark:text-dark-muted mb-2">Per-metric breakdown</p>
              <ul className="space-y-1.5">
                {conclusion.bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-ink/60 dark:text-dark-muted">
                    <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${b.favorable ? 'bg-success' : 'bg-danger'}`} />
                    {b.text}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {conclusion.actions.length > 0 && (
            <div className="border-t border-line/60 dark:border-dark-border pt-4">
              <p className="text-xs font-bold uppercase tracking-wide text-ink/75 dark:text-dark-muted mb-2">Actionable insights</p>
              <ul className="space-y-1.5">
                {conclusion.actions.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-ink/70 dark:text-dark-text">
                    <span className="mt-1 w-1.5 h-1.5 rounded-full shrink-0 bg-brand-red" />
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[10px] text-ink/60 dark:text-dark-muted italic pt-2 border-t border-line/60 dark:border-dark-border">
            Research-grade analytics derived from cohort correlations, not a diagnostic medical assessment.
          </p>
        </div>
      )}
    </Card>
  )
}

// Pulls a metric's live analysis (r, p-value, direction, this subject's
// point, cohort mean) out of the EQ x cardiac correlation payload — used
// throughout buildOverallConclusion so every narrative section is backed
// by the same live numbers as the scatter charts, never hardcoded.
function _metric(data, subjectId, key) {
  const a = data.analyses.find((x) => x.metric_key === key)
  if (!a) return null
  const numericPoints = (a.points || []).filter((p) => Number.isFinite(p.value))
  const point = numericPoints.find((p) => p.subject_id === subjectId)
  const mean = numericPoints.length ? numericPoints.reduce((s, p) => s + p.value, 0) / numericPoints.length : null
  return { ...a, point, mean, hasSignal: a.n >= 3 && a.r != null && Math.abs(a.r) >= 0.2 }
}

function _relationStrength(r) {
  if (r == null) return 'undetermined'
  const abs = Math.abs(r)
  return abs < 0.2 ? 'negligible' : abs < 0.5 ? 'moderate' : 'strong'
}

function buildOverallConclusion(data, subjectId, subjectSummary) {
  if (!data || data.insufficient_data || !subjectId) return null

  const riskMetric = _metric(data, subjectId, 'risk_score')
  const composure = _metric(data, subjectId, 'composure_index_proxy')
  const cogLoad = _metric(data, subjectId, 'cognitive_load_index')
  const hrv = _metric(data, subjectId, 'avg_rmssd')
  const stress = _metric(data, subjectId, 'avg_stress_index')
  const recovery = _metric(data, subjectId, 'avg_recovery_rate')
  const restingHr = _metric(data, subjectId, 'avg_heart_rate')
  const eqPoint = data.analyses[0]?.points?.find((p) => p.subject_id === subjectId)

  // --- per-metric favorable/unfavorable bullets (kept, now feeding the
  // "actionable insights" section below too instead of standing alone) ---
  const bullets = []
  for (const a of data.analyses) {
    const numericPoints = (a.points || []).filter((p) => Number.isFinite(p.value))
    const point = numericPoints.find((p) => p.subject_id === subjectId)
    if (!point || a.direction === 'neutral' || a.n < 3 || a.r == null || Math.abs(a.r) < 0.2 || !numericPoints.length) continue
    const mean = numericPoints.reduce((s, p) => s + p.value, 0) / numericPoints.length
    const aboveMean = point.value >= mean
    const favorable = a.direction === 'higher_better' ? aboveMean : !aboveMean
    bullets.push({
      key: a.metric_key,
      favorable,
      aboveMean,
      text: `${a.metric_label}: ${point.value}${a.unit ? ` ${a.unit.trim()}` : ''}, ${aboveMean ? 'above' : 'below'} the cohort average of ${safeFixed(mean)} — ${favorable ? 'a favorable sign' : 'worth keeping an eye on'} for this measure.`,
    })
  }

  const nFav = bullets.filter((b) => b.favorable).length
  const nTotal = bullets.length

  const scoreLine = subjectSummary?.risk_assessment?.risk_score != null
    ? ` Their ML Risk Score is ${Math.round(subjectSummary.risk_assessment.risk_score)}/100${
        subjectSummary.risk_assessment?.predicted_class ? `, placing them in the "${subjectSummary.risk_assessment.predicted_class}" risk band` : ''
      }.`
    : ''

  let summary
  if (nTotal === 0) {
    summary = `${formatSubjectId(subjectId)}${eqPoint ? ` (self-reported EQ score ${eqPoint.eq_score})` : ''} doesn't yet have enough cohort-wide correlation signal to characterize individual metrics, but here's what's on file overall.${scoreLine}`
  } else {
    const ratio = nFav / nTotal
    const overall = ratio >= 0.66 ? 'a broadly favorable' : ratio <= 0.34 ? 'a mixed-to-concerning' : 'a mixed'
    summary = `${formatSubjectId(subjectId)}${eqPoint ? ` (self-reported EQ score ${eqPoint.eq_score})` : ''} shows ${overall} cardiovascular and physiological profile: ${nFav} of ${nTotal} tracked metric${nTotal === 1 ? '' : 's'} with a meaningful EQ relationship ${nFav === 1 && nTotal === 1 ? 'sits' : 'sit'} on the healthy side of the cohort average.${scoreLine}`
  }

  // --- narrative sections: EQ <-> HR, EQ <-> HRV/Stress, Composure &
  // Cognitive Load, and a rolled-up health summary ---
  const sections = []

  if (restingHr) {
    const strength = _relationStrength(restingHr.r)
    const cohortLine = restingHr.hasSignal
      ? `Across the cohort, self-reported EQ shows a ${strength} ${restingHr.r > 0 ? 'positive' : 'negative'} relationship with resting heart rate (r = ${restingHr.r}${restingHr.p_value != null ? `, p = ${restingHr.p_value}` : ''}) — ${
          restingHr.r < 0
            ? 'people who rate their own emotional regulation higher tend to run a lower resting heart rate, consistent with better parasympathetic (vagal) control dampening baseline sympathetic drive.'
            : 'people who rate their own emotional regulation higher tend to run a higher resting heart rate in this sample, which runs counter to the usual autonomic story and is worth treating as a cohort-specific observation rather than a general rule given the small sample.'
        }`
      : `Across the cohort, the EQ-to-resting-heart-rate relationship is too weak or too sparse (n = ${restingHr.n}) to draw a directional conclusion yet.`
    const subjLine = restingHr.point
      ? ` ${formatSubjectId(subjectId)}'s own resting heart rate averages ${restingHr.point.value} bpm, ${restingHr.point.value >= restingHr.mean ? 'above' : 'below'} the cohort mean of ${safeFixed(restingHr.mean)} bpm.`
      : ''
    sections.push({
      heading: 'How EQ and Heart Rate influence each other',
      body: `${cohortLine}${subjLine} The relationship also runs the other way biologically: elevated heart rate during a stress or cognitive-load episode reflects heightened sympathetic arousal, which is exactly the physiological state that lower emotional-regulation ability struggles to bring back down quickly — so EQ and HR aren't just correlated, they sit on the same feedback loop (arousal drives HR up, and how efficiently that arousal is regulated is what EQ is trying to measure).`,
    })
  }

  if (hrv || stress) {
    const hrvStrength = hrv ? _relationStrength(hrv.r) : 'undetermined'
    const stressStrength = stress ? _relationStrength(stress.r) : 'undetermined'
    const hrvLine = hrv
      ? (hrv.hasSignal
          ? `HRV (RMSSD) shows a ${hrvStrength} ${hrv.r > 0 ? 'positive' : 'negative'} correlation with EQ (r = ${hrv.r}) — ${hrv.r > 0 ? 'higher self-reported EQ tracks with higher heart-rate variability, i.e. a more flexible, better-regulated autonomic nervous system' : 'higher self-reported EQ tracks with lower heart-rate variability in this sample, an unusual pattern worth revisiting as more subjects are added'}.`
          : `HRV (RMSSD) doesn't yet show a clear relationship with EQ in this sample (n = ${hrv.n}).`)
      : ''
    const stressLine = stress
      ? (stress.hasSignal
          ? ` Stress Index shows a ${stressStrength} ${stress.r > 0 ? 'positive' : 'negative'} correlation with EQ (r = ${stress.r}) — ${stress.r < 0 ? 'higher EQ tends to go with a lower physiological stress index, matching the intuition that better emotional regulation shows up as less sustained sympathetic load' : 'higher EQ tends to go with a higher physiological stress index in this sample, which may reflect subjects who self-rate their EQ highly while still carrying measurable physiological strain'}.`
          : ` Stress Index doesn't yet show a clear relationship with EQ in this sample (n = ${stress.n}).`)
      : ''
    const subjLine = [
      hrv?.point ? `${formatSubjectId(subjectId)}'s HRV averages ${hrv.point.value} ms (cohort mean ${safeFixed(hrv.mean)} ms).` : '',
      stress?.point ? `Stress Index averages ${stress.point.value} (cohort mean ${safeFixed(stress.mean)}).` : '',
    ].filter(Boolean).join(' ')
    sections.push({
      heading: 'EQ, HRV, and Stress Index',
      body: `${hrvLine}${stressLine} ${subjLine} HRV and Stress Index are effectively two views of the same autonomic balance: RMSSD captures short-term parasympathetic ("rest and digest") tone, while Stress Index leans toward sympathetic ("fight or flight") dominance — a subject who's high on one and low on the other is generally regulating well, while both sitting on the unfavorable side at once is the pattern most worth a closer look.`,
    })
  }

  if (composure || cogLoad) {
    const composureLine = composure
      ? `Composure Proxy is a derived measure of how stable a subject's physiological signals stay under load — it combines heart-rate stability, HRV, and stress-index behavior into one score, where higher means the subject's body stayed calmer and more controlled across the sit/walk/run/cognitive-task sequence. ${
          composure.point != null
            ? `${formatSubjectId(subjectId)} scores ${composure.point.value}/100 here, ${composure.point.value >= composure.mean ? 'above' : 'below'} the cohort average of ${safeFixed(composure.mean)}${composure.hasSignal ? `, and this measure correlates ${_relationStrength(composure.r)}ly with self-reported EQ (r = ${composure.r})` : ''}.`
            : 'No Composure Proxy value is on file for this subject yet.'
        }`
      : ''
    const cogLine = cogLoad
      ? ` Cognitive Load Index reflects how much additional physiological strain the cognitive task session added relative to rest — lower is better, since it means the subject's system absorbed the mental workload without a large stress spike. ${
          cogLoad.point != null
            ? `${formatSubjectId(subjectId)} scores ${cogLoad.point.value}, ${cogLoad.point.value <= cogLoad.mean ? 'below (better than)' : 'above'} the cohort average of ${safeFixed(cogLoad.mean)}.`
            : 'No Cognitive Load Index value is on file for this subject yet.'
        }`
      : ''
    sections.push({ heading: 'Composure Proxy & Cognitive Load Index, explained', body: `${composureLine}${cogLine}` })
  }

  if (recovery) {
    const recLine = recovery.point != null
      ? `Recovery Rate tracks how quickly heart rate and stress markers return toward baseline after an active session ends — ${formatSubjectId(subjectId)} averages ${recovery.point.value}${recovery.unit ? ` ${recovery.unit.trim()}` : ''}, ${recovery.point.value >= recovery.mean ? 'above' : 'below'} the cohort mean of ${safeFixed(recovery.mean)}. Faster recovery generally signals a more resilient autonomic nervous system — one that can mount a stress response when needed and then stand down efficiently, rather than staying activated.`
      : ''
    if (recLine) sections.push({ heading: 'Recovery Rate', body: recLine })
  }

  // --- rolled-up, actionable takeaways ---
  const actions = []
  const unfavorable = bullets.filter((b) => !b.favorable)
  if (bullets.find((b) => b.key === 'avg_stress_index' && !b.favorable)) {
    actions.push('Stress Index sits on the unfavorable side of the cohort average — breathing-paced or other short regulation exercises before high-demand sessions may help bring sympathetic load down.')
  }
  if (bullets.find((b) => b.key === 'avg_rmssd' && !b.favorable)) {
    actions.push('HRV is below the cohort average — consistent sleep, aerobic conditioning, and reducing stimulant intake near recording sessions are the levers most likely to move RMSSD over time.')
  }
  if (bullets.find((b) => b.key === 'cognitive_load_index' && !b.favorable)) {
    actions.push('Cognitive Load Index is elevated relative to the cohort — this subject\'s physiology reacts more strongly to mental workload than most; short recovery breaks between demanding tasks may reduce cumulative strain.')
  }
  if (bullets.find((b) => b.key === 'avg_recovery_rate' && !b.favorable)) {
    actions.push('Recovery Rate trails the cohort — post-activity cool-down duration and hydration are worth reviewing, since slower return-to-baseline is one of the more actionable (and trainable) markers here.')
  }
  if (unfavorable.length === 0 && nTotal > 0) {
    actions.push('No metric with a meaningful EQ relationship currently sits on the unfavorable side of the cohort average — the priority is maintaining current habits and continuing to log sessions so this assessment stays current.')
  }
  if (nTotal > 0 && bullets.length < data.analyses.filter((a) => a.direction !== 'neutral').length) {
    actions.push('A few metrics don\'t yet have a strong enough EQ correlation to weigh in here — more completed sessions/questionnaires across the cohort will sharpen these numbers.')
  }

  return { summary, sections, bullets, actions }
}

function ReferenceRangesCard({ data }) {
  if (!data) return null
  if (data.error) return <Card title="Per-activity reference ranges"><InsufficientData>{data.error}</InsufficientData></Card>
  // byActivity/features/ref are all read assuming a specific nested-object
  // shape (activity -> feature -> {healthy_low, healthy_high}). Any one of
  // those turning out to not be a plain object (artifact regenerated in an
  // older/newer shape, a feature entry that's null, etc.) threw on
  // `ref.healthy_low` and took the whole card down. Skip anything that
  // doesn't look like what it's supposed to instead of throwing.
  const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v)
  const byActivity = isObj(data.by_activity) ? data.by_activity : {}
  const activities = Object.entries(byActivity).filter(([, features]) => isObj(features))
  if (activities.length === 0) {
    return <Card title="Per-activity reference ranges"><InsufficientData>No reference ranges available yet.</InsufficientData></Card>
  }
  return (
    <Card title="Per-activity reference ranges (activity normalization)">
      <p className="text-xs text-ink/75 dark:text-dark-muted mb-3">
        Healthy bands derived separately for each activity — a resting range shouldn't be applied to a run session.
      </p>
      <div className="grid md:grid-cols-2 gap-4">
        {activities.map(([act, features]) => (
          <div key={act} className="border border-line dark:border-dark-border rounded-lg p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-brand-red mb-2">{ACTIVITY_LABELS[act] || act}</p>
            <ul className="space-y-1">
              {Object.entries(features).filter(([, ref]) => isObj(ref)).map(([feat, ref]) => (
                <li key={feat} className="flex justify-between text-xs">
                  <span className="text-ink/60 dark:text-dark-muted">{FEATURE_LABELS[feat] || feat}</span>
                  <span className="font-mono text-ink/80 dark:text-dark-text">{ref.healthy_low ?? '—'}–{ref.healthy_high ?? '—'}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  )
}