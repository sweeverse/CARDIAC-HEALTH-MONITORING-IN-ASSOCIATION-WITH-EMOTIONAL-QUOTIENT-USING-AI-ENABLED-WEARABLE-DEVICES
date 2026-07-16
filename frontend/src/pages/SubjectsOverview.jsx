import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, ArrowUpRight, Loader2, Users, Trash2 } from 'lucide-react'
import { Endpoints } from '../lib/api.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { formatSubjectId, subjectIdMatches } from '../lib/subjectId.js'
import { onDataChanged, notifyDataChanged } from '../lib/syncBus.js'
import { formatScore, formatPercentile } from '../lib/format.js'
import RiskBadge from '../components/RiskBadge.jsx'
import ScoreRing from '../components/ScoreRing.jsx'

export default function SubjectsOverview() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [subjects, setSubjects] = useState([])
  const [populationStats, setPopulationStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [deletingId, setDeletingId] = useState(null)
  const toast = useToast()

  const handleDeleteSubject = async (e, subjectId) => {
    e.preventDefault()
    e.stopPropagation()
    if (!window.confirm(`Permanently delete ${formatSubjectId(subjectId)} and every piece of their data from the cohort? This can't be undone.`)) return
    setDeletingId(subjectId)
    try {
      await Endpoints.deleteSubject(subjectId)
      setSubjects((prev) => prev.filter((s) => s.subject_id !== subjectId))
      notifyDataChanged({ source: 'admin-delete-subject' })
      toast?.success(`${formatSubjectId(subjectId)} deleted from the cohort.`)
    } catch (err) {
      toast?.error(err.response?.data?.detail || 'Could not delete this subject.')
    } finally {
      setDeletingId(null)
    }
  }

  useEffect(() => {
    // Backend already scopes this to just the caller's own subject when
    // they aren't an admin (spec B.2) — no separate code path needed here
    // to "hide" other participants, the data simply never arrives.
    Endpoints.listSubjects({ limit: 200 })
      .then((res) => setSubjects(res.data.subjects))
      .catch(() => setError('Could not load the cohort. Is the backend running and MONGODB_URI reachable?'))
      .finally(() => setLoading(false))

    if (!isAdmin) {
      Endpoints.populationStats().then((res) => setPopulationStats(res.data)).catch(() => {})
    }
  }, [isAdmin])

  useEffect(() => {
    return onDataChanged(() => {
      Endpoints.listSubjects({ limit: 200 }).then((res) => setSubjects(res.data.subjects)).catch(() => {})
      if (!isAdmin) {
        Endpoints.populationStats().then((res) => setPopulationStats(res.data)).catch(() => {})
      }
    })
  }, [isAdmin])

  const filtered = subjects.filter((s) => subjectIdMatches(s.subject_id, query))

  const counts = subjects.reduce((acc, s) => {
    const k = s.risk_assessment?.predicted_class || 'unknown'
    acc[k] = (acc[k] || 0) + 1
    return acc
  }, {})

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-ink/65">
        <Loader2 className="w-6 h-6 animate-spin text-brand-red" />
      </div>
    )
  }
  if (error) return <div className="card p-6 text-sm text-danger">{error}</div>

  // Normal user: only ever their own results, plus a cohort comparison
  // that unlocks once they've uploaded at least one recording (spec B.2).
  if (!isAdmin) {
    const own = subjects[0]
    const hasUploaded = own?.risk_assessment?.risk_score != null

    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-display font-semibold dark:text-dark-text">My cohort overview</h2>
          <p className="text-sm text-ink/80 dark:text-dark-muted mt-1">Your results and how you compare to the cohort.</p>
        </div>

        {!own || !hasUploaded ? (
          <div className="card p-8 text-center">
            <Users className="w-8 h-8 text-ink/50 dark:text-dark-muted mx-auto mb-3" />
            <p className="text-sm text-ink/60 dark:text-dark-muted">
              Upload your first recording to see your results and cohort comparison here.
            </p>
          </div>
        ) : (
          <>
            <Link
              to={`/app/subjects/${own.subject_id}`}
              className="card p-5 hover:shadow-pop hover:-translate-y-0.5 transition-all group block"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-display font-semibold text-lg dark:text-dark-text">{formatSubjectId(own.subject_id)} (you)</p>
                  <p className="text-xs text-ink/70 dark:text-dark-muted mt-0.5">
                    {own.demographics?.age ? `${Math.round(own.demographics.age)}y` : '—'} · BMI {own.demographics?.bmi?.toFixed?.(1) ?? '—'}
                  </p>
                </div>
                <ArrowUpRight className="w-4 h-4 text-ink/50 group-hover:text-brand-red transition-colors" />
              </div>
              <div className="flex items-center gap-4 mt-4">
                <ScoreRing score={own.risk_assessment?.risk_score} size={56} riskClass={own.risk_assessment?.predicted_class} />
                <div className="flex-1">
                  <RiskBadge riskClass={own.risk_assessment?.predicted_class} />
                  <p className="text-[11px] text-ink/65 dark:text-dark-muted mt-1.5">
                    {`Model-scored (unsupervised) · ${Math.round((own.risk_assessment?.probability || 0) * 100)}% confidence`}
                  </p>
                </div>
              </div>
            </Link>

            {populationStats && (
              <div className="card p-5">
                <p className="text-xs font-bold uppercase tracking-wide text-ink/70 dark:text-dark-muted mb-3">Cohort comparison</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <StatCard label="Cohort size" value={populationStats.cohort_size ?? '—'} />
                  <StatCard label="Your ML Risk Score" value={formatScore(own.risk_assessment?.risk_score)} />
                  <StatCard label="Your percentile" value={formatOverallPercentile(own.population_percentile)} />
                  <StatCard label="Your risk class" value={own.risk_assessment?.predicted_class ?? '—'} />
                </div>
                <p className="text-xs text-ink/70 dark:text-dark-muted mt-3">
                  See the Population Analytics tab on your subject page for the full percentile breakdown.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  // Admin: full cohort visibility (spec C.1) — unchanged.
  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-display font-semibold dark:text-dark-text">Cohort overview</h2>
          <p className="text-sm text-ink/80 dark:text-dark-muted mt-1">{subjects.length} subjects in this workspace</p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink/60 dark:text-dark-muted" />
          <input className="input-field pl-9" placeholder="Search subject ID (e.g. S01)..." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total subjects" value={subjects.length} />
        <StatCard label="Healthy" value={counts.healthy || 0} tone="success" />
        <StatCard label="Mild risk" value={counts['mild risk'] || 0} tone="warning" />
        <StatCard label="Moderate risk" value={counts['moderate risk'] || 0} tone="danger" />
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((s) => (
          <Link
            to={`/app/subjects/${s.subject_id}`}
            key={s.subject_id}
            className="relative card p-5 hover:shadow-pop hover:-translate-y-0.5 transition-all group"
          >
            <button
              onClick={(e) => handleDeleteSubject(e, s.subject_id)}
              disabled={deletingId === s.subject_id}
              title={`Delete ${formatSubjectId(s.subject_id)} from the cohort`}
              className="absolute top-3 right-3 z-10 p-1.5 rounded-md text-danger/70 bg-danger/5 hover:text-danger hover:bg-danger/15 dark:text-red-400/80 dark:bg-red-900/10 dark:hover:text-red-400 dark:hover:bg-red-900/25 transition-colors disabled:opacity-60"
            >
              {deletingId === s.subject_id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            </button>
            <div className="flex items-start justify-between">
              <div>
                <p className="font-display font-semibold text-lg dark:text-dark-text">{formatSubjectId(s.subject_id)}</p>
                <p className="text-xs text-ink/70 dark:text-dark-muted mt-0.5">
                  {s.demographics?.age ? `${Math.round(s.demographics.age)}y` : '—'} · BMI {s.demographics?.bmi?.toFixed?.(1) ?? '—'}
                </p>
              </div>
              <ArrowUpRight className="w-4 h-4 text-ink/50 group-hover:text-brand-red transition-colors" />
            </div>
            <div className="flex items-center gap-4 mt-4">
              <ScoreRing score={s.risk_assessment?.risk_score} size={56} riskClass={s.risk_assessment?.predicted_class} />
              <div className="flex-1">
                <RiskBadge riskClass={s.risk_assessment?.predicted_class} />
                <p className="text-[11px] text-ink/65 dark:text-dark-muted mt-1.5">
                  {`Model-scored (unsupervised) · ${Math.round((s.risk_assessment?.probability || 0) * 100)}% confidence`}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

// population_percentile is stored as a PER-BIOMARKER object
// ({ heart_rate: 62.5, rmssd: 40.1, ... }), never a single number — showing
// it directly (e.g. Math.round(own.population_percentile)) produced "NaNth"
// on this card. This averages the available per-feature percentiles into
// one overall figure, capped at 2 decimal places, and falls back to "—"
// (never "Nil") when nothing has been computed yet.
function formatOverallPercentile(perFeaturePercentiles) {
  if (!perFeaturePercentiles || typeof perFeaturePercentiles !== 'object') return '\u2014'
  const values = Object.values(perFeaturePercentiles).filter((v) => v != null && !Number.isNaN(v))
  if (values.length === 0) return '\u2014'
  const avg = values.reduce((a, b) => a + b, 0) / values.length
  return formatPercentile(avg)
}

function StatCard({ label, value, tone }) {
  const toneClass = {
    success: 'text-success',
    warning: 'text-brand-orange',
    danger: 'text-brand-red',
  }[tone] || 'text-ink dark:text-dark-text'
  return (
    <div className="card p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-ink/70 dark:text-dark-muted">{label}</p>
      <p className={`font-display font-semibold text-2xl mt-1 ${toneClass}`}>{value}</p>
    </div>
  )
}
