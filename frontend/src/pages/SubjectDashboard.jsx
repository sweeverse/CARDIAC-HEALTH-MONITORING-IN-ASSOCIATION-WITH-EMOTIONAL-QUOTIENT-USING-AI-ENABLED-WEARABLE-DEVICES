import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Download, Loader2 } from 'lucide-react'
import { Endpoints } from '../lib/api.js'
import { formatSubjectId } from '../lib/subjectId.js'
import { onDataChanged } from '../lib/syncBus.js'
import ScoreRing from '../components/ScoreRing.jsx'
import RiskBadge from '../components/RiskBadge.jsx'
import SessionsPanel from '../components/SessionsPanel.jsx'
import ExplainabilityPanel from '../components/ExplainabilityPanel.jsx'
import LongitudinalPanel from '../components/LongitudinalPanel.jsx'

const TABS = [
  { key: 'sessions', label: 'Sessions' },
  { key: 'explainability', label: 'Explainability' },
  { key: 'longitudinal', label: 'Longitudinal' },
]

export default function SubjectDashboard() {
  const { subjectId } = useParams()
  const [subject, setSubject] = useState(null)
  const [tab, setTab] = useState('sessions')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState('')

  useEffect(() => {
    setLoading(true); setError('')
    Endpoints.getSubject(subjectId)
      .then((res) => setSubject(res.data))
      .catch(() => setError('Subject not found.'))
      .finally(() => setLoading(false))
  }, [subjectId])

  // Task 16: whenever data changes anywhere (this tab or another), refresh
  // without requiring a manual reload. A silent refetch (no loading spinner
  // flash) so it doesn't interrupt whatever the person is looking at.
  useEffect(() => {
    return onDataChanged(() => {
      Endpoints.getSubject(subjectId).then((res) => setSubject(res.data)).catch(() => {})
    })
  }, [subjectId])

  const downloadReport = async () => {
    setReportLoading(true); setReportError('')
    try {
      // The report endpoint requires the Bearer auth header, which a plain
      // <a href> navigation can't send — that's why PDF export used to
      // fail. Fetching it through the authenticated axios client and
      // turning the response into a blob URL is what actually works.
      const res = await Endpoints.downloadReport(subjectId)
      const blob = new Blob([res.data], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `cardioeq_report_${subjectId}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setReportError('Could not generate the report. Try again in a moment.')
    } finally {
      setReportLoading(false)
    }
  }

  if (loading) return <div className="flex justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-brand-red" /></div>
  if (error) return <div className="card p-6 text-sm text-danger">{error}</div>
  if (!subject) return null

  return (
    <div>
      <Link to="/app" className="inline-flex items-center gap-1.5 text-sm text-ink/80 hover:text-brand-red mb-4">
        <ArrowLeft className="w-3.5 h-3.5" /> Cohort overview
      </Link>

      <div className="card p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5">
          <div className="flex items-center gap-5">
            <ScoreRing score={subject.risk_assessment?.risk_score} size={72} strokeWidth={7} riskClass={subject.risk_assessment?.predicted_class} />
            <div>
              <h2 className="text-2xl font-display font-semibold">{formatSubjectId(subject.subject_id)}</h2>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-xs uppercase tracking-wide text-ink/60 dark:text-dark-muted">ML Risk Score</p>
                <RiskBadge riskClass={subject.risk_assessment?.predicted_class} />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <Demo label="Age" value={subject.demographics?.age ? Math.round(subject.demographics.age) : '—'} />
            <Demo label="BMI" value={subject.demographics?.bmi?.toFixed?.(1) ?? '—'} />
            <Demo label="Composure proxy" value={subject.composure_index_proxy ?? '—'} hint="Derived, not measured EQ" />
            {subject.cognitive_load_index?.cognitive_load_index != null && (
              <Demo
                label="Cognitive load"
                value={subject.cognitive_load_index.cognitive_load_index}
                hint={subject.cognitive_load_index.interpretation || 'Cog vs. sit delta'}
              />
            )}
            <div>
              <button onClick={downloadReport} disabled={reportLoading} className="btn-primary">
                {reportLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                {reportLoading ? 'Generating...' : 'PDF report'}
              </button>
              {reportError && <p className="text-[11px] text-danger mt-1 text-right">{reportError}</p>}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 mb-6 border-b border-line/70 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${
              tab === t.key ? 'border-brand-red text-brand-red' : 'border-transparent text-ink/75 hover:text-ink/80 dark:text-dark-muted dark:hover:text-dark-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'sessions' && <SessionsPanel subjectId={subjectId} />}
      {tab === 'explainability' && <ExplainabilityPanel subjectId={subjectId} />}
      {tab === 'longitudinal' && <LongitudinalPanel subjectId={subjectId} />}
    </div>
  )
}

function Demo({ label, value, hint }) {
  return (
    <div className="text-right">
      <p className="text-xs uppercase tracking-wide text-ink dark:text-white font-semibold">{label}</p>
      <p className="font-mono text-base font-medium text-ink dark:text-white">{value}</p>
      {hint && <p className="text-xs text-ink/70 dark:text-white/70">{hint}</p>}
    </div>
  )
}
