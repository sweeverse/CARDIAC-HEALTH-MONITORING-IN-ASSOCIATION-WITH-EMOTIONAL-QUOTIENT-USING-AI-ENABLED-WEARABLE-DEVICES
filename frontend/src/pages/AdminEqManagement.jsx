import { useEffect, useMemo, useState } from 'react'
import { ClipboardList, Loader2, CheckCircle2, ShieldCheck, Search, X } from 'lucide-react'
import { Endpoints } from '../lib/api.js'
import { useToast } from '../context/ToastContext.jsx'
import EqQuestionnaireForm from '../components/EqQuestionnaireForm.jsx'
import { formatSubjectId, subjectIdMatches } from '../lib/subjectId.js'
import { notifyDataChanged } from '../lib/syncBus.js'

// Response scale legend — same "1 = Strongly Disagree ... 5 = Strongly
// Agree" legend shown above the questionnaire on the Upload Recording page,
// duplicated here (rather than shared) so this file has no dependency on
// that page's internals.
function EqScaleLegend() {
  const SCALE = [
    { v: 5, label: 'Strongly Agree' },
    { v: 4, label: 'Agree' },
    { v: 3, label: 'Neutral' },
    { v: 2, label: 'Disagree' },
    { v: 1, label: 'Strongly Disagree' },
  ]
  return (
    <div className="mb-3 p-2.5 bg-paper dark:bg-dark-surface border border-line/60 dark:border-dark-border rounded-lg">
      <p className="text-[10px] font-bold text-ink/60 dark:text-dark-muted uppercase tracking-wide mb-1.5">Response scale</p>
      <div className="grid grid-cols-5 gap-1 text-center">
        {SCALE.map(({ v, label }) => (
          <div key={v}>
            <span className="block font-mono font-bold text-sm text-brand-red">{v}</span>
            <span className="text-[10px] text-ink/70 dark:text-dark-muted leading-tight">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Card-based EQ management (spec C.3): one card per subject, a subject
// number search field for quick navigation, and direct view/edit of each
// participant's EQ self-report baseline.
export default function AdminEqManagement() {
  const [subjects, setSubjects] = useState([])
  const [loadingSubjects, setLoadingSubjects] = useState(true)
  const [query, setQuery] = useState('')
  const [selectedSubject, setSelectedSubject] = useState('')
  const [answers, setAnswers] = useState({})
  const [existing, setExisting] = useState(null)
  const [status, setStatus] = useState(null) // null | 'loading' | 'saved'
  const toast = useToast()

  useEffect(() => {
    Endpoints.listSubjects({ limit: 200 })
      .then((res) => setSubjects(res.data.subjects || []))
      .finally(() => setLoadingSubjects(false))
  }, [])

  useEffect(() => {
    setAnswers({}); setExisting(null); setStatus(null)
    if (!selectedSubject) return
    Endpoints.getEqAssessment(selectedSubject).then((res) => setExisting(res.data))
  }, [selectedSubject])

  const filtered = useMemo(() => {
    return subjects
      .filter((s) => subjectIdMatches(s.subject_id, query))
      .sort((a, b) => formatSubjectId(a.subject_id).localeCompare(formatSubjectId(b.subject_id)))
  }, [subjects, query])

  const submit = async () => {
    if (!selectedSubject || Object.keys(answers).length === 0) return
    setStatus('loading')
    try {
      const res = await Endpoints.submitEqAssessment(selectedSubject, answers)
      setExisting({ eq_score: res.data.eq_score, eq_subscores: res.data.eq_subscores, has_completed: true })
      setStatus('saved')
      notifyDataChanged({ source: 'eq-assessment' })
      toast?.success(`EQ baseline saved for ${formatSubjectId(selectedSubject)}.`)
      setSubjects((prev) => prev.map((s) => s.subject_id === selectedSubject ? { ...s, eq_score: res.data.eq_score } : s))
    } catch (err) {
      setStatus(null)
      toast?.error(err.response?.data?.detail || 'Could not save this EQ baseline.')
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h2 className="text-2xl font-display font-semibold dark:text-dark-text flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-brand-red" /> Admin EQ Management
        </h2>
        <p className="text-sm text-ink/80 dark:text-dark-muted mt-1">
          Complete or update the EQ self-report baseline for any subject already in the database.
        </p>
      </div>

      {selectedSubject ? (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-brand-red" />
              <h3 className="font-display font-semibold text-base dark:text-dark-text">
                {formatSubjectId(selectedSubject)} — EQ-style self-report
              </h3>
            </div>
            <button onClick={() => setSelectedSubject('')} className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-dark-surface text-ink/75 dark:text-dark-muted">
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-ink/75 dark:text-dark-muted mb-4 leading-relaxed">
            An original 15-item self-report covering self-awareness, self-regulation, motivation, empathy, and social
            skills — written for this project, not a licensed clinical instrument.
          </p>

          {existing?.has_completed && (
            <div className="flex items-center gap-2 text-sm text-success mb-4">
              <CheckCircle2 className="w-4 h-4" /> Already completed — EQ score: {existing.eq_score}/100. Submitting again will overwrite it.
            </div>
          )}

          <EqScaleLegend />
          <EqQuestionnaireForm answers={answers} setAnswers={setAnswers} />

          <button onClick={submit} disabled={status === 'loading' || Object.keys(answers).length === 0} className="btn-primary mt-4">
            {status === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {status === 'saved' ? 'Saved \u2713' : `Save baseline (${Object.keys(answers).length} answered)`}
          </button>
        </div>
      ) : (
        <>
          <div className="relative max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink/60 dark:text-dark-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by Subject Number (e.g. S01)"
              className="input-field pl-9 w-full"
            />
          </div>

          {loadingSubjects ? (
            <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-brand-red" /></div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-ink/70 dark:text-dark-muted italic">No subjects match "{query}".</p>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map((s) => (
                <button
                  key={s.subject_id}
                  onClick={() => setSelectedSubject(s.subject_id)}
                  className="card p-4 text-left hover:border-brand-red/40 hover:shadow-pop transition-all"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono font-bold text-base text-ink dark:text-dark-text">{formatSubjectId(s.subject_id)}</span>
                    {s.eq_score != null ? (
                      <CheckCircle2 className="w-4 h-4 text-success" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-brand-orange" />
                    )}
                  </div>
                  <p className="text-xs text-ink/75 dark:text-dark-muted">
                    {s.eq_score != null ? `Baseline completed \u2014 ${s.eq_score}/100` : 'No baseline yet'}
                  </p>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}