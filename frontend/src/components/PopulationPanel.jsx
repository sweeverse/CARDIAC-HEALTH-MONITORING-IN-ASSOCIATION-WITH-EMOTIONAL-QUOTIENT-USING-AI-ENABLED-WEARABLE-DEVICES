import { useEffect, useState } from 'react'
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Tooltip, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, ReferenceArea } from 'recharts'
import { Loader2, Users, Info } from 'lucide-react'
import { Endpoints } from '../lib/api.js'
import { directionFor } from '../lib/biomarkerDirections.js'
import DirectionBadge from './DirectionBadge.jsx'
import { onDataChanged } from '../lib/syncBus.js'

const LABELS = {
  heart_rate: 'Heart Rate', rr_interval_ms: 'RR Interval', rmssd: 'RMSSD',
  sdnn: 'SDNN', stress_index: 'Stress Index', recovery_rate: 'Recovery',
  motion_intensity: 'Motion', bmi: 'BMI', age: 'Age',
}

// Normal/healthy reference ranges for plain-language context
const NORMAL_RANGES = {
  heart_rate: '60–100 bpm at rest',
  rmssd: '20–50 ms (higher is better)',
  sdnn: '50–100 ms at rest',
  stress_index: '20–40 at rest',
  recovery_rate: 'positive values = recovering',
  rr_interval_ms: '600–1000 ms (rest)',
  bmi: '18.5–24.9 (normal)',
  motion_intensity: 'low during sit/cog tasks',
}

// Insight about BMI, temp, humidity vs heart rate — built from THIS subject's
// actual demographics and most recent session's environmental readings,
// instead of one static paragraph shown for every subject.
function buildEnvInsight(demographics, envSession, heartRatePct) {
  const bmi = demographics?.bmi
  const temp = envSession?.env_temp_c
  const humidity = envSession?.env_humidity_pct
  const hr = envSession?.avg_heart_rate

  if (bmi == null && temp == null && humidity == null) {
    return "No BMI or environmental readings are available yet for this subject to draw this connection."
  }

  const bmiHigh = bmi != null && bmi >= 25
  const hotEnv = temp != null && temp >= 28
  const humidEnv = humidity != null && humidity >= 60

  const parts = []
  if (bmi != null) {
    parts.push(`This subject's BMI is ${bmi.toFixed(1)} (${bmiHigh ? 'above the 18.5–24.9 normal range, adding baseline cardiac workload' : 'within the normal 18.5–24.9 range'}).`)
  }
  if (temp != null || humidity != null) {
    const envBits = []
    if (temp != null) envBits.push(`${temp.toFixed(1)}°C ambient temperature`)
    if (humidity != null) envBits.push(`${humidity.toFixed(0)}% humidity`)
    parts.push(`Their most recent session was recorded at ${envBits.join(' and ')}${(hotEnv || humidEnv) ? ', which raises thermal load on the body' : ', a mild environment with minimal added thermal load'}.`)
  }
  if (hr != null) {
    const compounding = bmiHigh && (hotEnv || humidEnv)
    parts.push(
      compounding
        ? `Combined with their BMI, this session's average heart rate of ${hr.toFixed(1)} bpm${heartRatePct != null ? ` (${heartRatePct}th percentile)` : ''} may run 5–15 bpm above this subject's true resting baseline — worth factoring in before comparing them against the cohort.`
        : `Their average heart rate this session was ${hr.toFixed(1)} bpm${heartRatePct != null ? ` (${heartRatePct}th percentile)` : ''}, which isn't being meaningfully inflated by BMI or environment right now.`
    )
  }
  return parts.join(' ')
}

function describePercentile(feature, pct) {
  if (pct == null) return null
  const favorable = directionFor(feature) === 'lower_better' ? pct <= 50 : pct >= 50
  const label = LABELS[feature] || feature
  const standing = pct >= 90 || pct <= 10 ? 'far' : pct >= 75 || pct <= 25 ? 'notably' : 'somewhat'
  if (pct === 50) return `${label} is right at the cohort median.`
  const positionWord = pct > 50 ? 'higher' : 'lower'
  return `${label} is ${standing} ${positionWord} than ${pct > 50 ? pct : 100 - pct}% of the cohort — ${favorable ? 'a favorable position' : 'worth monitoring'}.`
}

function featurePlainInsight(feature, pct, stats) {
  const label = LABELS[feature] || feature
  const normalRange = NORMAL_RANGES[feature] || ''
  const direction = directionFor(feature) === 'lower_better'
    ? (pct <= 30 ? 'well within a healthy zone for this metric' : pct >= 70 ? 'elevated compared to peers — worth monitoring' : 'within typical range')
    : (pct >= 70 ? 'in a favorable zone' : pct <= 30 ? 'below the cohort average — may indicate room for improvement' : 'within typical range')

  return `This subject's ${label} is at the ${pct}th percentile — ${direction}. Normal reference: ${normalRange}. Cohort median: ${stats?.p50 ?? '—'}.`
}

export default function PopulationPanel({ subjectId }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Endpoints.getPopulationComparison(subjectId).then((res) => setData(res.data)).finally(() => setLoading(false))
  }, [subjectId])

  useEffect(() => {
    return onDataChanged(() => {
      Endpoints.getPopulationComparison(subjectId).then((res) => setData(res.data)).catch(() => {})
    })
  }, [subjectId])

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-brand-red" /></div>
  if (!data) return null

  const percentiles = data.population_percentile || {}
  const radarData = Object.entries(percentiles)
    .filter(([, v]) => v != null)
    .map(([k, v]) => ({
      metric: LABELS[k] || k,
      cohort: v,
      similar: data.similar_cohort_percentile?.[k] ?? null,
    }))

  const extremes = Object.entries(percentiles)
    .filter(([, v]) => v != null)
    .map(([k, v]) => ({ feature: k, pct: v, distFromMedian: Math.abs(v - 50) }))
    .sort((a, b) => b.distFromMedian - a.distFromMedian)
    .slice(0, 2)

  // NEW: cohort-wide unsupervised risk_score distribution, this subject
  // highlighted. Real data from population_stats.risk_score_distribution
  // (written offline by ml-pipeline/build_dataset.py) — not fabricated.
  const scoreDist = (data.risk_score_distribution || []).map((d) => ({
    subject: d.subject,
    risk_score: d.risk_score,
    y: 0,
    isThis: d.subject === subjectId,
  }))

  return (
    <div className="space-y-5">
      {extremes.length > 0 && (
        <div className="card p-5 border border-brand-red/15 bg-red-50/40 dark:bg-red-950/20 dark:border-red-900/30">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-brand-red" />
            <h3 className="font-display font-semibold text-sm dark:text-dark-text">How this subject compares</h3>
          </div>
          <ul className="space-y-1.5">
            {extremes.map((e) => (
              <li key={e.feature} className="text-sm text-ink/75 dark:text-dark-text">{describePercentile(e.feature, e.pct)}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Radar Chart */}
        <div className="card p-5">
          <h3 className="font-display font-semibold text-base mb-1 dark:text-dark-text">Percentile rank vs. cohort</h3>
          <p className="text-xs text-ink/75 dark:text-dark-muted mb-4">Across all {data.cohort_size} subjects in the database, and a similar-profile peer group (±5yrs age, ±5 BMI).</p>
          <ResponsiveContainer width="100%" height={340}>
            <RadarChart data={radarData} outerRadius={110}>
              <PolarGrid stroke="#E6E1D3" />
              <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11, fill: '#0F2421CC' }} />
              <PolarRadiusAxis
                domain={[0, 100]}
                tickCount={5}
                ticks={[0, 25, 50, 75, 100]}
                tick={{ fontSize: 9, fill: '#0F242166' }}
                axisLine={false}
              />
              <Radar
                name="Full cohort" dataKey="cohort" stroke="#CF0A0A" fill="#CF0A0A" fillOpacity={0.2}
                label={{ fontSize: 10, fill: '#CF0A0A', fontWeight: 700, offset: 8 }}
              />
              <Radar name="Similar profile" dataKey="similar" stroke="#2F8F5B" fill="#2F8F5B" fillOpacity={0.14} />
              <Tooltip
                contentStyle={{ borderRadius: 10, border: '1px solid #DCD6C7', fontSize: 12 }}
                formatter={(v, name) => [v != null ? `${v}th percentile` : '—', name]}
              />
            </RadarChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-4 mt-2 text-xs">
            <Legend color="#CF0A0A" label="Full cohort (numbers = this subject's percentile)" />
            <Legend color="#2F8F5B" label="Similar physiological profile (±5yrs age, ±5 BMI)" />
          </div>
          {/* Radar chart insight box */}
          <div className="mt-4 p-3 bg-paper dark:bg-dark-surface border border-line/60 dark:border-dark-border rounded-lg">
            <p className="text-[11px] text-ink/60 dark:text-dark-muted leading-relaxed">
              <strong className="text-ink/80 dark:text-dark-text">How to read this:</strong> Each ring (0–100) marks a percentile — the outer edge is the 100th percentile.
              The number at each point is this subject's exact percentile for that biomarker. A larger red shape means better standing across the full cohort.
              Discrepancies between the red and green shapes reveal where peer-group factors (age, BMI) explain the subject's position.
            </p>
          </div>
        </div>

        {/* Reference Distribution */}
        <div className="card p-5">
          <h3 className="font-display font-semibold text-base mb-1 dark:text-dark-text">Reference distribution</h3>
          <p className="text-xs text-ink/75 dark:text-dark-muted mb-4">The marker shows exactly where this subject sits within the cohort's spread for each biomarker.</p>
          <div className="space-y-4">
            {Object.entries(data.cohort_reference || {}).map(([k, stats]) => {
              const pct = percentiles[k]
              const markerPos = pct != null ? Math.max(2, Math.min(98, pct)) : null
              const favorable = pct != null && (directionFor(k) === 'lower_better' ? pct <= 50 : pct >= 50)
              const markerColor = pct == null ? '#CF0A0A' : favorable ? '#2F8F5B' : '#CF0A0A'
              return (
                <div key={k}>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="font-bold text-ink/80 dark:text-dark-text capitalize flex items-center gap-1.5">
                      {LABELS[k] || k}
                      <DirectionBadge feature={k} />
                    </span>
                    <span className="font-mono text-ink/70 dark:text-dark-muted">p25 {stats.p25} · median {stats.p50} · p75 {stats.p75}</span>
                  </div>
                  <div className="h-3 bg-line/40 dark:bg-dark-border rounded-full relative overflow-hidden">
                    <div className="absolute inset-y-0 bg-brand-red/10 dark:bg-red-900/20" style={{ left: '25%', right: '25%' }} />
                    {markerPos != null && (
                      <div
                        className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2 border-white shadow-sm"
                        style={{ left: `calc(${markerPos}% - 7px)`, background: markerColor }}
                        title={`${pct}th percentile — ${favorable ? 'favorable' : 'worth monitoring'}`}
                      />
                    )}
                  </div>
                  {pct != null && (
                    <p className="text-[10px] mt-1" style={{ color: markerColor }}>{pct}th percentile — {favorable ? 'favorable' : 'worth monitoring'}</p>
                  )}
                </div>
              )
            })}
          </div>
          {/* Reference distribution insight */}
          <div className="mt-4 p-3 bg-paper dark:bg-dark-surface border border-line/60 dark:border-dark-border rounded-lg">
            <p className="text-[11px] text-ink/60 dark:text-dark-muted leading-relaxed">
              <strong className="text-ink/80 dark:text-dark-text">How to read this:</strong> The shaded band marks the middle 50% of the cohort (25th–75th percentile).
              The dot is this subject — <span className="text-[#2F8F5B] font-semibold">green</span> means a favorable position for that biomarker,
              <span className="text-brand-red font-semibold"> red</span> means it's worth monitoring. A dot to the right means a higher value than most; to the left means lower —
              whether right or left is "favorable" depends on the biomarker (lower stress is better, higher HRV is better).
            </p>
          </div>
        </div>
      </div>

      {/* Risk score vs. cohort distribution — a genuine 2D visualization
          (Task 19): X = risk score, Y = rank within the cohort (so points
          fan out instead of overlapping on one line), a shaded normal
          range, bucket-colored points, and outliers ringed in black. */}
      {scoreDist.length > 0 && (() => {
        const sorted = [...scoreDist].sort((a, b) => a.risk_score - b.risk_score)
        const ranked = sorted.map((d, i) => ({ ...d, rank: i + 1 }))
        const thresholds = data.bucket_thresholds || {}
        const bucketColor = (score) => {
          if (thresholds.mild_risk_at != null && score < thresholds.mild_risk_at) return '#2F8F5B'
          if (thresholds.moderate_risk_at != null && score < thresholds.moderate_risk_at) return '#DC5F00'
          return '#CF0A0A'
        }
        const isOutlier = (score) => thresholds.moderate_risk_at != null && score >= thresholds.moderate_risk_at
        const thisSubject = ranked.find((d) => d.isThis)

        return (
          <div className="card p-5">
            <h3 className="font-display font-semibold text-base mb-1 dark:text-dark-text">Risk score vs. cohort distribution</h3>
            <p className="text-xs text-ink/75 dark:text-dark-muted mb-4">
              Each dot is one of the {ranked.length} subjects in the database, positioned by their unsupervised
              (GMM + Isolation Forest) risk score and ranked against the cohort. The larger dot is this subject.
            </p>
            <ResponsiveContainer width="100%" height={280}>
              <ScatterChart margin={{ top: 10, right: 20, bottom: 24, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                {thresholds.mild_risk_at != null && (
                  <ReferenceArea x1={0} x2={thresholds.mild_risk_at} fill="#2F8F5B" fillOpacity={0.08} ifOverflow="extendDomain" />
                )}
                {thresholds.moderate_risk_at != null && (
                  <ReferenceArea x1={thresholds.moderate_risk_at} x2={100} fill="#CF0A0A" fillOpacity={0.06} ifOverflow="extendDomain" />
                )}
                <XAxis
                  type="number" dataKey="risk_score" domain={[0, 100]} tick={{ fontSize: 10 }} name="Risk score"
                  label={{ value: 'Unsupervised risk score', position: 'bottom', fontSize: 10, offset: 0 }}
                />
                <YAxis
                  type="number" dataKey="rank" tick={{ fontSize: 10 }} name="Cohort rank"
                  label={{ value: 'Cohort rank (low → high risk)', angle: -90, position: 'insideLeft', fontSize: 10 }}
                />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const p = payload[0].payload
                    return (
                      <div className="bg-white dark:bg-dark-surface border border-line/60 dark:border-dark-border rounded px-2 py-1.5 text-[11px] shadow">
                        <strong>{p.subject}{p.isThis ? ' (this subject)' : ''}</strong><br />
                        risk score {p.risk_score} · rank {p.rank}/{ranked.length}
                        {isOutlier(p.risk_score) ? <><br /><span className="text-brand-red font-semibold">Outlier — moderate risk bucket</span></> : null}
                      </div>
                    )
                  }}
                />
                <Scatter
                  data={ranked}
                  dataKey="rank"
                  isAnimationActive
                  animationDuration={600}
                  animationEasing="ease-out"
                  shape={(props) => {
                    const { cx, cy, payload: d } = props
                    const outlier = isOutlier(d.risk_score)
                    const r = d.isThis ? 8 : outlier ? 6 : 4.5
                    return (
                      <circle
                        cx={cx} cy={cy} r={r}
                        fill={bucketColor(d.risk_score)}
                        stroke={d.isThis || outlier ? '#0F2421' : 'none'}
                        strokeWidth={d.isThis ? 2.5 : outlier ? 1.5 : 0}
                      />
                    )
                  }}
                />
              </ScatterChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-4 mt-1 flex-wrap text-[11px] text-ink/80 dark:text-dark-muted">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#2F8F5B]" /> Normal range</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#DC5F00]" /> Mild risk</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#CF0A0A] ring-2 ring-ink/80" /> Outlier (moderate risk)</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-ink/70 dark:bg-white/70 ring-2 ring-ink/80" /> This subject</span>
            </div>
            {data.cohort_comparison && (
              <p className="text-[11px] text-ink/80 dark:text-dark-muted mt-2">
                Risk score <strong className="text-ink/75 dark:text-dark-text">{data.cohort_comparison.subject_risk_score}</strong> vs.
                {' '}cohort average <strong className="text-ink/75 dark:text-dark-text">{data.cohort_comparison.cohort_avg_risk_score}</strong>
                {' '}— <span className={
                  data.cohort_comparison.classification === 'better than cohort' ? 'text-[#2F8F5B] font-semibold' :
                  data.cohort_comparison.classification === 'worse than cohort' ? 'text-brand-red font-semibold' :
                  'font-semibold text-ink/80 dark:text-dark-text'
                }>{data.cohort_comparison.classification}</span>
                {' '}({data.cohort_comparison.difference_from_cohort > 0 ? '+' : ''}{data.cohort_comparison.difference_from_cohort} pts)
              </p>
            )}
            {thisSubject && (
              <p className="text-[11px] text-ink/80 dark:text-dark-muted mt-2">
                This subject ranks <strong className="text-ink/75 dark:text-dark-text">{thisSubject.rank} of {ranked.length}</strong> in
                the cohort ({thisSubject.rank <= ranked.length / 2 ? 'lower' : 'higher'} risk than the median)
                {isOutlier(thisSubject.risk_score) && <span className="text-brand-red font-semibold"> — flagged as an outlier in the moderate-risk bucket.</span>}
              </p>
            )}
          </div>
        )
      })()}

      {/* Environmental & BMI vs Heart Rate insight */}
      <div className="card p-5 border border-brand-orange/20 dark:border-orange-900/30 bg-orange-50/30 dark:bg-orange-950/20">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-brand-orange mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-bold text-ink/85 dark:text-dark-text mb-1">BMI, environment & heart rate — what's the connection?</p>
            <p className="text-xs text-ink/65 dark:text-dark-muted leading-relaxed">
              {buildEnvInsight(data.demographics, data.latest_session_env, percentiles.heart_rate)}
            </p>
          </div>
        </div>
      </div>

      {/* Per-biomarker plain language insights */}
      <div className="card p-5">
        <h3 className="font-display font-semibold text-base mb-4 dark:text-dark-text">What each percentile means for this subject</h3>
        <div className="space-y-3">
          {Object.entries(percentiles).map(([k, pct]) => {
            if (pct == null) return null
            const stats = data.cohort_reference?.[k]
            return (
              <div key={k} className="flex items-start gap-3 text-xs border-t border-line/50 dark:border-dark-border pt-3 first:border-t-0 first:pt-0">
                <span className="font-bold text-ink/70 dark:text-dark-text w-24 shrink-0 capitalize">{LABELS[k] || k}</span>
                <p className="text-ink/80 dark:text-dark-muted leading-relaxed">{featurePlainInsight(k, pct, stats)}</p>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Legend({ color, label }) {
  return (
    <div className="flex items-center gap-1.5 text-ink/80 dark:text-dark-muted">
      <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} /> {label}
    </div>
  )
}

// DirectionBadge moved to components/DirectionBadge.jsx (spec C) — shared
// across PopulationPanel, TimeSeriesPanel, ExplainabilityPanel.
