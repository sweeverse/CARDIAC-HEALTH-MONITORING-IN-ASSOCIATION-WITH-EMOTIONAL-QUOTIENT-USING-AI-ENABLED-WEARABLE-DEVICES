import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceDot, ReferenceLine,
} from 'recharts'
import { Loader2, TrendingUp, TrendingDown, ArrowRight, Info } from 'lucide-react'
import { Endpoints } from '../lib/api.js'
import DirectionBadge from './DirectionBadge.jsx'
import { onDataChanged } from '../lib/syncBus.js'

const METRICS = [
  { key: 'heart_rate', label: 'Heart Rate', unit: 'bpm', color: '#CF0A0A',
    normalMin: 60, normalMax: 100,
    normalLabel: 'Normal resting range: 60–100 bpm',
    context: 'A faster rise during exertion is healthy; a slow post-activity fall is an independent cardiac risk marker.',
  },
  { key: 'rmssd', label: 'RMSSD (HRV)', unit: 'ms', color: '#DC5F00',
    normalMin: 20, normalMax: 50,
    normalLabel: 'Healthy resting range: 20–50 ms (higher is better)',
    context: 'Higher RMSSD reflects more parasympathetic (calming) nervous system activity.',
  },
  { key: 'sdnn', label: 'SDNN (HRV)', unit: 'ms', color: '#0E4F4A',
    normalMin: 50, normalMax: 100,
    normalLabel: 'Healthy resting range: 50–100 ms (higher is better)',
    context: 'SDNN captures total heart rhythm variability; run sessions typically suppress it versus sit baselines.',
  },
  { key: 'rr_interval_ms', label: 'RR Interval', unit: 'ms', color: '#1A5C55',
    normalMin: 600, normalMax: 1000,
    normalLabel: 'Normal resting range: 600–1000 ms (= 60–100 bpm)',
    context: 'Irregular fluctuation is normal and healthy — a very flat, regular RR interval is actually a warning sign.',
  },
  { key: 'stress_index', label: 'Stress Index', unit: '/100', color: '#C98A2E',
    normalMin: 20, normalMax: 40,
    normalLabel: 'Normal resting range: 20–40 (lower is better at rest)',
    context: 'Elevated stress index during a sit or cognitive session suggests heightened fight-or-flight activation.',
  },
  { key: 'recovery_rate', label: 'Recovery Rate', unit: 'bpm/win', color: '#7FB3AA',
    normalMin: 0, normalMax: null,
    normalLabel: 'Positive values indicate recovering heart rate; near-zero is normal during rest',
    context: 'Recovery rate is most meaningful after run activity, where a fast decline signals strong cardiovascular fitness.',
  },
  { key: 'spo2', label: 'SpO\u2082', unit: '%', color: '#2563A8',
    normalMin: 95, normalMax: 100,
    normalLabel: 'Normal range: 95–100% (below 90% is clinically significant)',
    context: 'Blood oxygen saturation from the MAX30102 pulse oximeter — sustained dips during exertion can flag respiratory or circulatory strain.',
  },
  { key: 'skin_temp_c', label: 'Temperature', unit: '\u00b0C', color: '#8A5FBF',
    normalMin: 33, normalMax: 37,
    normalLabel: 'Healthy peripheral skin range: 33–37\u00b0C',
    context: 'Skin surface temperature from the DS18B20 probe — cooler and more variable than core body temperature, shifting with blood flow, exertion, and ambient conditions.',
  },
]

const ACTIVITIES = ['sit', 'walk', 'run', 'cog']

function findExtrema(values, minGap = 2) {
  const extrema = []
  for (let i = 1; i < values.length - 1; i++) {
    const prev = values[i - 1], cur = values[i], next = values[i + 1]
    if (prev == null || cur == null || next == null) continue
    const isPeak = cur > prev && cur > next
    const isTrough = cur < prev && cur < next
    if (isPeak || isTrough) {
      if (extrema.length === 0 || i - extrema[extrema.length - 1].index >= minGap) {
        extrema.push({ index: i, type: isPeak ? 'peak' : 'trough' })
      }
    }
  }
  return extrema
}

function linearFit(values) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => v != null)
  const n = pts.length
  if (n < 3) return null
  const xMean = pts.reduce((s, [x]) => s + x, 0) / n
  const yMean = pts.reduce((s, [, y]) => s + y, 0) / n
  let num = 0, den = 0
  for (const [x, y] of pts) { num += (x - xMean) * (y - yMean); den += (x - xMean) ** 2 }
  const slope = den ? num / den : 0
  const intercept = yMean - slope * xMean
  let ssRes = 0, ssTot = 0
  for (const [x, y] of pts) {
    const pred = slope * x + intercept
    ssRes += (y - pred) ** 2
    ssTot += (y - yMean) ** 2
  }
  const r2 = ssTot ? 1 - ssRes / ssTot : 0
  return { slope, r2 }
}

function buildConclusion(metric, { avg, isInNormalRange, trend, activity, peakVal }) {
  const activityLabel = activity === 'cog' ? 'cognitive task' : activity
  const a = avg.toFixed(1)

  if (metric.key === 'recovery_rate') {
    if (activity === 'run' || activity === 'walk') {
      if (peakVal != null && peakVal > 12) {
        return `This subject showed strong recovery this ${activityLabel} session — peaking at ${peakVal.toFixed(1)} bpm/window, a solid cardiovascular fitness marker.`
      }
      return `Recovery this ${activityLabel} session peaked at ${peakVal != null ? peakVal.toFixed(1) : 'a modest'} bpm/window — below the fast-decline range that signals strong fitness.`
    }
    return `Averaging ${a} bpm/window during this ${activityLabel} session, which is expected — there's minimal exertion to recover from while ${activity === 'sit' ? 'sitting' : 'doing a cognitive task'}.`
  }

  const higherIsBetter = metric.key !== 'stress_index' && metric.key !== 'heart_rate'
  const trendNote = trend
    ? (higherIsBetter
        ? (trend.direction === 'rising' ? ' It also trended upward across the session — a reassuring pattern.' : ' It also trended downward across the session, worth watching.')
        : (trend.direction === 'falling' ? ' It also eased downward across the session — a good recovery pattern.' : ' It also climbed steadily across the session, compounding the concern.'))
    : ''

  if (isInNormalRange) {
    return `Averaging ${a} ${metric.unit} during this ${activityLabel} session, this subject sits comfortably within the healthy range.${trendNote}`
  }
  return `Averaging ${a} ${metric.unit} during this ${activityLabel} session, this subject falls outside the healthy range — worth flagging for follow-up.${trendNote}`
}

export default function TimeSeriesPanel({ subjectId, activity: fixedActivity = null, sessionId = null }) {
  // When embedded inside a specific session's card, `fixedActivity` pins
  // this panel to exactly that session (activity + sessionId) and hides
  // the activity switcher below — switching activity would mean leaving
  // the session this card represents. Used standalone (neither prop
  // passed), it keeps its original behavior: a self-managed switcher over
  // the merged, all-sessions-of-that-activity chronological view.
  const [activity, setActivity] = useState(fixedActivity || 'sit')
  const [windows, setWindows] = useState([])
  const [insights, setInsights] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // The actual activity to fetch/display. `activity` state only exists for
  // the standalone switcher's own selection (below) — when this panel is
  // pinned via `fixedActivity`, that always wins outright. Deriving this
  // rather than syncing `activity` state to `fixedActivity` in an effect
  // matters: an effect-based sync lags a render behind, so switching tabs
  // would first re-fire the fetch with the OLD activity + the NEW
  // sessionId (a mismatched combo the backend rejects) before catching up
  // on the next render — which is exactly what produced "no recorded
  // session" errors quoting the wrong activity after switching tabs.
  const effectiveActivity = fixedActivity || activity

  useEffect(() => {
    setLoading(true); setError('')
    Promise.all([
      Endpoints.getTimeseries(subjectId, effectiveActivity, sessionId),
      Endpoints.getInsights(subjectId, effectiveActivity, sessionId).catch(() => ({ data: { insights: [] } })),
    ])
      .then(([ts, ins]) => { setWindows(ts.data.windows); setInsights(ins.data.insights || []) })
      .catch(() => { setError(`No recorded session for activity "${effectiveActivity}".`); setWindows([]); setInsights([]) })
      .finally(() => setLoading(false))
  }, [subjectId, effectiveActivity, sessionId])

  useEffect(() => {
    return onDataChanged(() => {
      Promise.all([
        Endpoints.getTimeseries(subjectId, effectiveActivity, sessionId),
        Endpoints.getInsights(subjectId, effectiveActivity, sessionId).catch(() => ({ data: { insights: [] } })),
      ]).then(([ts, ins]) => { setWindows(ts.data.windows); setInsights(ins.data.insights || []) }).catch(() => {})
    })
  }, [subjectId, effectiveActivity, sessionId])

  const chartData = useMemo(
    () => windows.map((w) => ({ ...w, t_min: Number((w.t_start_sec / 60).toFixed(2)) })),
    [windows]
  )

  return (
    <div className="space-y-5">
      {!fixedActivity && (
        <div className="flex items-center gap-2 flex-wrap">
          {ACTIVITIES.map((a) => (
            <button
              key={a}
              onClick={() => setActivity(a)}
              className={`pill capitalize border ${effectiveActivity === a ? 'bg-brand-red text-white border-brand-red' : 'bg-white dark:bg-dark-card text-ink/60 dark:text-dark-muted border-line dark:border-dark-border hover:border-brand-red/40'}`}
            >
              {a === 'cog' ? 'Cognitive task' : a.charAt(0).toUpperCase() + a.slice(1)}
            </button>
          ))}
        </div>
      )}

      {loading && <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-brand-red" /></div>}
      {error && !loading && <div className="card p-6 text-sm text-ink/80 dark:text-dark-muted">{error}</div>}

      {!loading && !error && (
        <div className="grid md:grid-cols-2 gap-5">
          {METRICS.map((m) => (
            <MetricChart key={m.key} metric={m} data={chartData} insights={insights} activity={effectiveActivity} />
          ))}
        </div>
      )}
    </div>
  )
}

function MetricChart({ metric, data, insights, activity }) {
  const values = data.map((d) => d[metric.key])
  const numeric = values.filter((v) => v != null && !Number.isNaN(v))

  const { domain, extrema, trend, peakVal, troughVal } = useMemo(() => {
    if (numeric.length === 0) return { domain: ['auto', 'auto'], extrema: [], trend: null, peakVal: null, troughVal: null }
    const min = Math.min(...numeric), max = Math.max(...numeric)
    const span = max - min
    const pad = span > 1e-6 ? span * 0.15 : Math.max(Math.abs(max) * 0.05, 0.5)
    // Ensure domain includes 0 for recovery_rate so negative values show
    const domMin = metric.key === 'recovery_rate' ? Math.min(0, min - pad) : min - pad
    const dom = [Number(domMin.toFixed(3)), Number((max + pad).toFixed(3))]
    const ext = findExtrema(values).map((e) => ({ ...e, value: values[e.index], t_min: data[e.index]?.t_min }))
    const fit = linearFit(values)
    const tr = fit && fit.r2 > 0.85 && Math.abs(fit.slope) > 1e-4
      ? { direction: fit.slope > 0 ? 'rising' : 'falling', r2: fit.r2 }
      : null
    const peaks = ext.filter(e => e.type === 'peak')
    const troughs = ext.filter(e => e.type === 'trough')
    const pVal = peaks.length > 0 ? Math.max(...peaks.map(e => e.value)) : null
    const tVal = troughs.length > 0 ? Math.min(...troughs.map(e => e.value)) : null
    return { domain: dom, extrema: ext, trend: tr, peakVal: pVal, troughVal: tVal }
  }, [data, metric.key])

  const relatedInsight = insights.find((i) =>
    i.why_detected?.toLowerCase().includes(metric.label.split(' ')[0].toLowerCase())
  )

  const avg = numeric.length > 0 ? numeric.reduce((a, b) => a + b, 0) / numeric.length : null

  const isInNormalRange = numeric.length > 0 && (() => {
    const inMin = metric.normalMin == null || avg >= metric.normalMin
    const inMax = metric.normalMax == null || avg <= metric.normalMax
    return inMin && inMax
  })()

  const conclusion = avg != null
    ? buildConclusion(metric, { avg, isInNormalRange, trend, activity, peakVal })
    : `No data recorded yet for this activity.`

  const validTMins = data
    .filter((d) => d[metric.key] != null && !Number.isNaN(d[metric.key]) && d.t_min != null)
    .map((d) => d.t_min)
  const xDomain = validTMins.length >= 2
    ? [Math.min(...validTMins), Math.max(...validTMins)]
    : ['dataMin', 'dataMax']

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-bold text-ink/80 dark:text-dark-text">{metric.label}</p>
          <DirectionBadge feature={metric.key} />
        </div>
        <span className="text-xs font-mono text-ink/65 dark:text-dark-muted">{metric.unit}</span>
      </div>

      {trend && (
        <div className={`flex items-center gap-1.5 text-[11px] mb-2 ${trend.direction === 'rising' ? 'text-brand-red' : 'text-success'}`}>
          {trend.direction === 'rising' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          <span>Consistently {trend.direction} across this session — this is a real measured trend, not a chart artifact.</span>
        </div>
      )}

      <ResponsiveContainer width="100%" height={190}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E6E1D3" />
          <XAxis
            dataKey="t_min" type="number" domain={xDomain} allowDataOverflow
            tick={{ fontSize: 10, fill: '#0F242199' }}
            label={{ value: 'min', position: 'insideBottomRight', offset: -2, fontSize: 10 }}
          />
          <YAxis domain={domain} tick={{ fontSize: 10, fill: '#0F242199' }} />
          {/* Normal range reference lines */}
          {metric.normalMin != null && (
            <ReferenceLine y={metric.normalMin} stroke={metric.color} strokeDasharray="4 3" strokeOpacity={0.35} />
          )}
          {metric.normalMax != null && (
            <ReferenceLine y={metric.normalMax} stroke={metric.color} strokeDasharray="4 3" strokeOpacity={0.35} />
          )}
          <Tooltip
            contentStyle={{ borderRadius: 10, border: '1px solid #DCD6C7', fontSize: 12 }}
            labelFormatter={(v) => `${v} min`}
            formatter={(v) => [typeof v === 'number' ? v.toFixed(2) : v, metric.label]}
          />
          <Line type="monotone" dataKey={metric.key} stroke={metric.color} strokeWidth={2} dot={false} connectNulls />
          {extrema.map((e, i) => (
            <ReferenceDot
              key={i} x={e.t_min} y={e.value} r={3.5}
              fill={e.type === 'peak' ? '#CF0A0A' : '#0E4F4A'}
              stroke="#fff" strokeWidth={1}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      {extrema.length > 0 && (
        <p className="text-[10px] text-ink/60 dark:text-dark-muted mt-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-red mr-1" />peak
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-red ml-3 mr-1" />trough
          <span className="ml-2">— {extrema.length} detected this session</span>
        </p>
      )}

      {/* Insight from backend if available */}
      {relatedInsight && (
        <div className="mt-3 pt-3 border-t border-line/60 dark:border-dark-border text-xs text-ink/65 dark:text-dark-muted flex items-start gap-1.5">
          <ArrowRight className="w-3 h-3 mt-0.5 shrink-0 text-brand-red" />
          <span>{relatedInsight.impact}</span>
        </div>
      )}

      {/* Normal range + cardiac health insight */}
      <div className="mt-3 p-3 bg-paper dark:bg-dark-surface border border-line/60 dark:border-dark-border rounded-lg space-y-1.5">
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isInNormalRange ? 'bg-success' : 'bg-brand-red'}`} />
          <p className="text-[10px] font-bold text-ink/70 dark:text-dark-text uppercase tracking-wide">
            {metric.normalLabel}
            {numeric.length > 0 && (
              <span className={`ml-2 font-normal normal-case ${isInNormalRange ? 'text-success' : 'text-brand-red'}`}>
                — avg {avg.toFixed(1)} {metric.unit}
                {isInNormalRange ? ' ✓ within range' : ' ⚠ outside range'}
              </span>
            )}
          </p>
        </div>
        <p className="text-[11px] font-semibold text-ink/75 dark:text-dark-text leading-relaxed">
          {conclusion}
        </p>
        <p className="text-[11px] text-ink/75 dark:text-dark-muted leading-relaxed">
          {metric.context}
        </p>
      </div>
    </div>
  )
}