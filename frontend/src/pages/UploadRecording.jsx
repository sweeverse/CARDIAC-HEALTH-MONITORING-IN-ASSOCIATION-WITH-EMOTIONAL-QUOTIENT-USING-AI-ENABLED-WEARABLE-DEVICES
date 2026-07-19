import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { UploadCloud, Loader2, CheckCircle2, AlertCircle, FileText, X, Trash2, ClipboardList, RefreshCw, LayoutGrid, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { Endpoints } from '../lib/api.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { formatSubjectId, subjectIdMatches } from '../lib/subjectId.js'
import { formatScore } from '../lib/format.js'
import { notifyDataChanged } from '../lib/syncBus.js'
import EqQuestionnaireForm, { useEqQuestionCount } from '../components/EqQuestionnaireForm.jsx'

const MAX_FILES = 4
const KNOWN_ACTIVITIES = ['sit', 'walk', 'run', 'cog']

function detectActivity(filename) {
  const stem = filename.replace(/\.csv$/i, '').replace(/_modified$/i, '').toLowerCase()
  return KNOWN_ACTIVITIES.find((a) => stem.endsWith(`_${a}`) || stem === a) || null
}

const SUBJECTS_PER_PAGE = 10

// Paginated, calendar-style subject picker — replaces the plain <datalist>
// dropdown, which just dumped all 20+ subjects into one native browser
// list (slow to scroll, inconsistent rendering across browsers, no
// grouping). The free-text input alongside it is UNCHANGED and still the
// only way to type a brand-new subject number to create a participant —
// this only adds a faster way to BROWSE/select an existing one.
function SubjectPicker({ value, onChange, knownSubjects }) {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(0)
  const [query, setQuery] = useState('')
  const rootRef = useRef(null)

  useEffect(() => {
    const onClickOutside = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const filtered = query.trim()
    ? knownSubjects.filter((id) => subjectIdMatches(id, query))
    : knownSubjects
  const pageCount = Math.max(1, Math.ceil(filtered.length / SUBJECTS_PER_PAGE))
  const safePage = Math.min(page, pageCount - 1)
  const pageStart = safePage * SUBJECTS_PER_PAGE
  const pageSubjects = filtered.slice(pageStart, pageStart + SUBJECTS_PER_PAGE)

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setPage(0); setQuery('') }}
        className={`h-full flex items-center justify-center px-3.5 rounded-lg border transition-colors ${
          open
            ? 'bg-brand-red text-white border-brand-red'
            : 'bg-white dark:bg-dark-card text-ink/60 dark:text-dark-muted border-line dark:border-dark-border hover:border-brand-red/40 hover:text-brand-red dark:hover:text-red-400'
        }`}
        title="Browse existing subjects"
        aria-label="Browse existing subjects"
      >
        <LayoutGrid className="w-4 h-4" />
      </button>

      {open && (
        <div className="absolute z-30 right-0 mt-1.5 w-72 sm:w-80 card p-3 shadow-lg">
          <div className="relative mb-2.5">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/40" />
            <input
              autoFocus
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(0) }}
              placeholder="Filter…"
              className="input-field w-full pl-8 py-1.5 text-sm"
            />
          </div>

          {filtered.length === 0 ? (
            <p className="text-xs text-ink/60 dark:text-dark-muted text-center py-4">No subjects match "{query}".</p>
          ) : (
            <>
              {/* Calendar-style page navigator — Subjects 1–10, 11–20, etc. */}
              <div className="flex items-center justify-between mb-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                  className="p-1 rounded-md text-ink/60 dark:text-dark-muted hover:bg-paper dark:hover:bg-dark-card disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink/60 dark:text-dark-muted">
                  Subjects {pageStart + 1}–{Math.min(pageStart + SUBJECTS_PER_PAGE, filtered.length)} of {filtered.length}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  disabled={safePage >= pageCount - 1}
                  className="p-1 rounded-md text-ink/60 dark:text-dark-muted hover:bg-paper dark:hover:bg-dark-card disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-5 gap-1.5">
                {pageSubjects.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => { onChange(id); setOpen(false) }}
                    className={`font-mono text-xs font-semibold py-1.5 rounded-md transition-colors ${
                      id === value
                        ? 'bg-brand-red text-white'
                        : 'bg-paper dark:bg-dark-surface text-ink/75 dark:text-dark-muted hover:bg-red-50 dark:hover:bg-dark-card hover:text-brand-red'
                    }`}
                  >
                    {formatSubjectId(id)}
                  </button>
                ))}
              </div>

              {pageCount > 1 && (
                <div className="flex items-center justify-center gap-1 mt-2.5">
                  {Array.from({ length: pageCount }, (_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setPage(i)}
                      aria-label={`Page ${i + 1}`}
                      className={`w-1.5 h-1.5 rounded-full transition-colors ${i === safePage ? 'bg-brand-red' : 'bg-line dark:bg-dark-border'}`}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// Response scale legend, shown above the EQ questionnaire on this page only
// (spec: Upload Recording page) — the questionnaire form itself still keeps
// its own compact one-line reminder at the bottom for when it's used
// elsewhere (retake/admin flows).
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

export default function UploadRecording() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const toast = useToast()
  const isAdmin = user?.role === 'admin'

  const [files, setFiles] = useState([])

  // Admin-only manual targeting (spec C.2): types ANY subject number,
  // creating a brand-new one or updating an existing participant.
  const [adminSubjectId, setAdminSubjectId] = useState('')
  const [adminAge, setAdminAge] = useState('')
  const [adminHeight, setAdminHeight] = useState('')
  const [adminWeight, setAdminWeight] = useState('')
  const [knownSubjects, setKnownSubjects] = useState([])

  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  // Files the backend flagged as a duplicate subject+activity recording
  // whose data actually differs from what's on file (Task 5). Re-submitting
  // sends the SAME file(s) again with confirm_replace set true — either one
  // at a time or all pending conflicts together via resolveAllConflicts.
  const [conflicts, setConflicts] = useState([])

  // Own subject_id for normal users — completely automatic and invisible
  // (spec B.1): assigned at signup, never chosen here.
  const mySubjectId = user?.subject_id
  const activeSubjectId = isAdmin ? adminSubjectId.trim() : mySubjectId

  // Previously-uploaded sessions for the active subject, so they can be
  // reviewed (and, for admins, deleted) right from this page.
  const [priorSessions, setPriorSessions] = useState([])
  const [priorSessionsLoading, setPriorSessionsLoading] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [deleteBusyId, setDeleteBusyId] = useState(null)

  // --- EQ Style Self Report (spec B.3): lives on THIS page now, never on
  // Explainability, and a user may only ever complete it for themselves. ---
  const eqQuestionCount = useEqQuestionCount()
  const [eqStatus, setEqStatus] = useState('loading') // loading | has_baseline | no_baseline | unknown
  const [eqChoice, setEqChoice] = useState(null) // null | 'retake' | 'skip'
  const [eqAnswers, setEqAnswers] = useState({})
  const [eqSubmitted, setEqSubmitted] = useState(false)
  const [eqSaving, setEqSaving] = useState(false)

  useEffect(() => {
    if (isAdmin) {
      Endpoints.listSubjects({ limit: 200 }).then((res) => {
        setKnownSubjects((res.data.subjects || []).map((s) => s.subject_id).sort())
      }).catch(() => {})
    }
  }, [isAdmin])

  useEffect(() => {
    setConfirmDeleteId(null)
    setEqChoice(null); setEqAnswers({}); setEqSubmitted(false)
    // Previously only priorSessions/EQ state reset here — the upload
    // result banner, any pending conflicts, the staged file picker, and
    // any error text all silently carried over from whichever subject was
    // active before. That's what let the "S01 uploaded" success banner
    // (and its "View S01 dashboard" button, just relabeled to the new
    // subject) keep showing after switching to a S02 that had nothing
    // uploaded yet — this is a fresh subject, so start from a fresh form.
    setResult(null); setConflicts([]); setError(''); setFiles([]); setUploadProgress(0)
    if (!activeSubjectId) { setPriorSessions([]); setEqStatus('unknown'); return }

    setPriorSessionsLoading(true)
    Endpoints.getSessions(activeSubjectId)
      .then((res) => setPriorSessions(res.data.sessions || []))
      .catch(() => setPriorSessions([]))
      .finally(() => setPriorSessionsLoading(false))

    setEqStatus('loading')
    Endpoints.getEqAssessment(activeSubjectId)
      .then((res) => setEqStatus(res.data.has_completed ? 'has_baseline' : 'no_baseline'))
      .catch(() => setEqStatus('no_baseline'))
  }, [activeSubjectId])

  // Saves the EQ self-report on its own, immediately, with no session CSV
  // required. Used by both the first-time ("no baseline yet") form and the
  // Retake flow — the backend endpoint (POST /{subject_id}/eq-assessment)
  // already supports being called standalone; this was previously only
  // wired up for Retake, forcing first-time users to also upload a
  // recording just to get their EQ score saved.
  const saveEqStandalone = async () => {
    if (Object.keys(eqAnswers).length === 0) return
    setEqSaving(true)
    try {
      await Endpoints.submitEqAssessment(activeSubjectId, eqAnswers)
      setEqSubmitted(true)
      setEqStatus('has_baseline')
      toast?.success('EQ self-report saved.')
    } catch {
      setError('Could not save the EQ questionnaire. Try again.')
    } finally {
      setEqSaving(false)
    }
  }

  // Whether the recording upload may proceed, EQ-wise.
  const eqGateSatisfied =
    eqStatus === 'loading' ? false
      : eqStatus === 'no_baseline' ? (eqSubmitted || Object.keys(eqAnswers).length >= eqQuestionCount)
        : (eqChoice === 'skip' || eqSubmitted)

  const confirmDelete = async (sessionId) => {
    setDeleteBusyId(sessionId)
    try {
      await Endpoints.deleteSession(activeSubjectId, sessionId)
      setPriorSessions((prev) => prev.filter((s) => s._id !== sessionId))
      setConfirmDeleteId(null)
      notifyDataChanged({ source: 'delete-session' })
      toast?.success('Session deleted.')
    } catch (err) {
      toast?.error(err.response?.data?.detail || 'Could not delete that session. Try again.')
    } finally {
      setDeleteBusyId(null)
    }
  }

  const addFiles = (newFiles) => {
    const csvOnly = Array.from(newFiles).filter((f) => /\.csv$/i.test(f.name))
    setFiles([...files, ...csvOnly].slice(0, MAX_FILES))
  }
  const removeFile = (idx) => setFiles(files.filter((_, i) => i !== idx))

  const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); setDragActive(true) }
  const handleDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); setDragActive(false) }
  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setDragActive(false)
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
  }

  const runUpload = async ({ confirmReplace = false, confirmAdd = false, onlyFilenames = null } = {}) => {
    setError(''); setUploadProgress(0)
    const formData = new FormData()
    if (isAdmin) {
      formData.append('subject_id', adminSubjectId.trim())
      formData.append('age', adminAge)
      formData.append('height_cm', adminHeight)
      formData.append('weight_kg', adminWeight)
    }
    if (eqStatus === 'no_baseline' && Object.keys(eqAnswers).length > 0) {
      formData.append('eq_answers', JSON.stringify(eqAnswers))
    }
    if (confirmReplace) formData.append('confirm_replace', 'true')
    if (confirmAdd) formData.append('confirm_add', 'true')
    const filesToSend = onlyFilenames ? files.filter((f) => onlyFilenames.includes(f.name)) : files
    filesToSend.forEach((f) => formData.append('files', f))

    setLoading(true)
    try {
      const res = await Endpoints.uploadRecording(formData, (evt) => {
        if (evt.total) setUploadProgress(Math.round((evt.loaded / evt.total) * 100))
      })
      setResult((prev) => (onlyFilenames && prev
        ? {
            ...res.data,
            files: [...prev.files.filter((f) => !onlyFilenames.includes(f.filename)), ...res.data.files],
            succeeded: prev.succeeded + res.data.succeeded,
            failed: prev.files.filter((f) => !onlyFilenames.includes(f.filename) && !f.success).length + res.data.failed,
          }
        : res.data))
      const stillNeedsConfirmation = res.data.files.filter((f) => f.requires_confirmation)
      setConflicts(stillNeedsConfirmation)
      if (res.data.succeeded > 0) notifyDataChanged({ source: 'upload', subjectId: isAdmin ? adminSubjectId.trim() : mySubjectId })
      if (stillNeedsConfirmation.length > 0) {
        toast?.error(`${stillNeedsConfirmation.length} file(s) need confirmation before they can be processed.`)
      } else if (res.data.failed > 0 && res.data.succeeded === 0) {
        setError('All files failed to process — see details below.')
        toast?.error('Upload failed for all files.')
      } else {
        toast?.success(`Upload complete — ${res.data.succeeded}/${res.data.total_files} file(s) processed.`)
      }
    } catch (err) {
      const msg = err.response?.data?.detail || 'Upload failed unexpectedly. Check your connection and try again.'
      setError(msg)
      toast?.error(msg)
    } finally {
      setLoading(false)
      setUploadProgress(0)
    }
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    if (files.length === 0) { setError('Please upload your activity CSV files to continue.'); return }
    if (isAdmin && !adminSubjectId.trim()) { setError('Subject Number is required.'); return }
    if (isAdmin && (adminAge === '' || adminHeight === '' || adminWeight === '')) {
      setError('Age, height, and weight are required before uploading or modifying subject data.'); return
    }
    if (!isAdmin && !mySubjectId) {
      setError("Your account isn't linked to a Subject ID yet. Please contact an administrator."); return
    }
    if (!eqGateSatisfied) {
      setError(
        eqStatus === 'no_baseline'
          ? 'Please complete the EQ self-report before finishing the upload.'
          : 'Please choose Retake or Skip for the EQ self-report before uploading.'
      )
      return
    }
    setResult(null); setConflicts([])
    await runUpload({})
  }

  // action: 'confirm' proceeds with whatever this file's own conflict calls
  // for (an exact-match file gets replaced, a new-occasion file gets added
  // to the longitudinal dataset — the backend decides which per file, so
  // sending both flags is safe even for a mixed batch); 'skip' just drops
  // it from the pending list.
  const resolveConflict = async (conflict, action) => {
    if (action === 'skip') {
      setConflicts((prev) => prev.filter((c) => c.filename !== conflict.filename))
      return
    }
    await runUpload({ confirmReplace: true, confirmAdd: true, onlyFilenames: [conflict.filename] })
  }

  // Bulk resolution — apply the same decision to every pending conflict at
  // once and analyze all of them in a single request, instead of forcing
  // one confirm click per file (previously the only option). Works even
  // when the batch mixes exact-match and new-session conflicts, since each
  // file resolves according to its own conflict type.
  const resolveAllConflicts = async (action) => {
    const filenames = conflicts.map((c) => c.filename)
    if (action === 'skip') {
      setConflicts([])
      return
    }
    await runUpload({ confirmReplace: true, confirmAdd: true, onlyFilenames: filenames })
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-display font-semibold mb-1 dark:text-dark-text">Upload recordings</h2>
      <p className="text-sm text-ink/80 dark:text-dark-muted mb-6">
        Upload your activity CSVs (sit, walk, run, cognitive task). Each is automatically windowed,
        risk-scored, and added to your timeline — one bad file won't block the others.
      </p>

      <form onSubmit={onSubmit} className="card p-6 space-y-5">
        {isAdmin ? (
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="label-field">Subject Number</label>
              <div className="flex items-stretch gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink/35 dark:text-dark-muted/60 pointer-events-none" />
                  <input
                    className="input-field font-mono pl-9"
                    value={adminSubjectId}
                    onChange={(e) => setAdminSubjectId(e.target.value)}
                    placeholder="Type or search a subject ID…"
                  />
                </div>
                {knownSubjects.length > 0 && (
                  <SubjectPicker value={adminSubjectId.trim()} onChange={setAdminSubjectId} knownSubjects={knownSubjects} />
                )}
              </div>
              <p className="text-[11px] text-ink/65 dark:text-dark-muted mt-1">
                Type a new Subject Number to create a participant, or an existing one to add a session to their timeline
                {knownSubjects.length > 0 ? ' — or browse existing subjects with the grid icon.' : '.'}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="label-field">Age</label>
                <input type="number" className="input-field" value={adminAge} onChange={(e) => setAdminAge(e.target.value)} placeholder="29" />
              </div>
              <div>
                <label className="label-field">Height (cm)</label>
                <input type="number" className="input-field" value={adminHeight} onChange={(e) => setAdminHeight(e.target.value)} placeholder="170" />
              </div>
              <div>
                <label className="label-field">Weight (kg)</label>
                <input type="number" className="input-field" value={adminWeight} onChange={(e) => setAdminWeight(e.target.value)} placeholder="65" />
              </div>
            </div>
          </div>
        ) : (
          <div className="input-field bg-paper dark:bg-dark-surface text-ink/60 dark:text-dark-muted flex items-center gap-2 select-none cursor-default">
            <span className="font-mono font-semibold text-brand-red">{mySubjectId ? formatSubjectId(mySubjectId) : '—'}</span>
            <span className="text-xs text-ink/65 dark:text-dark-muted">your subject number · age/height/weight come from your Profile</span>
          </div>
        )}

        {/* EQ Style Self Report — moved here from Explainability (spec B.3) */}
        {activeSubjectId && (
          <div className="border border-line/60 dark:border-dark-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <ClipboardList className="w-4 h-4 text-brand-red" />
              <h3 className="font-display font-semibold text-sm dark:text-dark-text">EQ style self report</h3>
            </div>
            {eqStatus === 'loading' && (
              <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-brand-red" /></div>
            )}
            {eqStatus === 'no_baseline' && !eqSubmitted && (
              <>
                <p className="text-xs text-ink/75 dark:text-dark-muted mb-3">No baseline yet — this is required before your first upload.</p>
                <EqScaleLegend />
                <EqQuestionnaireForm answers={eqAnswers} setAnswers={setEqAnswers} />
                <button
                  type="button"
                  onClick={saveEqStandalone}
                  disabled={eqSaving || Object.keys(eqAnswers).length === 0}
                  className="btn-secondary text-xs mt-3 px-3 py-1.5"
                  title="Save your EQ score now, without uploading a recording"
                >
                  {eqSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Save EQ only
                </button>
              </>
            )}
            {eqStatus === 'has_baseline' && !eqChoice && !eqSubmitted && (
              <div className="flex items-center gap-3">
                <p className="text-xs text-ink/80 dark:text-dark-muted flex-1">You already have a baseline. Retake it, or skip and keep your existing score.</p>
                <button type="button" onClick={() => setEqChoice('retake')} className="btn-secondary text-xs px-3 py-1.5">Retake</button>
                <button type="button" onClick={() => setEqChoice('skip')} className="btn-secondary text-xs px-3 py-1.5">Skip</button>
              </div>
            )}
            {eqChoice === 'retake' && !eqSubmitted && (
              <>
                <EqScaleLegend />
                <EqQuestionnaireForm answers={eqAnswers} setAnswers={setEqAnswers} />
                <button type="button" onClick={saveEqStandalone} disabled={eqSaving || Object.keys(eqAnswers).length === 0} className="btn-primary text-xs mt-3 px-3 py-1.5">
                  {eqSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Save EQ retake
                </button>
              </>
            )}
            {(eqSubmitted || eqChoice === 'skip') && (
              <div className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="w-4 h-4" /> EQ self-report ready for this upload.</div>
            )}
          </div>
        )}

        <div>
          <label className="label-field">Activity CSVs ({files.length}/{MAX_FILES})</label>
          {files.length < MAX_FILES && (
            <label
              onDragOver={handleDragOver}
              onDragEnter={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`flex items-center gap-3 border-2 border-dashed rounded-xl p-5 cursor-pointer transition-colors ${
                dragActive
                  ? 'border-brand-red bg-brand-red/5'
                  : 'border-line dark:border-dark-border hover:border-brand-red/50'
              }`}
            >
              <UploadCloud className={`w-6 h-6 shrink-0 transition-transform ${dragActive ? 'text-brand-red scale-110' : 'text-brand-red'}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink/75 dark:text-dark-text">
                  {dragActive ? 'Drop to add these files' : 'Drag & drop your sit, walk, run & cognitive task CSVs here, or click to browse'}
                </p>
                <p className="text-xs text-ink/65 dark:text-dark-muted mt-1">
                  Filenames should end in <span className="font-mono">_sit</span>, <span className="font-mono">_walk</span>, <span className="font-mono">_run</span>, <span className="font-mono">_cog</span> for automatic activity detection
                </p>
              </div>
              <input type="file" accept=".csv" multiple className="hidden" onChange={(e) => { addFiles(e.target.files || []); e.target.value = '' }} />
            </label>
          )}

          {files.length > 0 && (
            <ul className="mt-3 space-y-2">
              {files.map((f, i) => {
                const detected = detectActivity(f.name)
                return (
                  <li key={i} className="flex items-center gap-3 bg-paper dark:bg-dark-surface rounded-lg px-3 py-2 text-sm border border-line/50 dark:border-dark-border">
                    <FileText className="w-4 h-4 text-brand-red shrink-0" />
                    <span className="flex-1 truncate text-ink/75 dark:text-dark-text">{f.name}</span>
                    <span className={`text-xs font-mono capitalize shrink-0 ${detected ? 'text-success' : 'text-brand-orange'}`}>
                      {detected ? `\u2713 ${detected}` : '\u26a0 activity unclear'}
                    </span>
                    <button type="button" onClick={() => removeFile(i)} className="text-ink/55 hover:text-danger shrink-0">
                      <X className="w-4 h-4" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 text-sm text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2.5">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
          </div>
        )}

        {loading && (
          <div className="w-full h-1.5 bg-paper dark:bg-dark-surface rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-red transition-all duration-200 ease-out"
              style={{ width: `${uploadProgress || 5}%` }}
            />
          </div>
        )}

        <button type="submit" disabled={loading || files.length === 0} className="btn-primary w-full py-2.5">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
          {loading
            ? (uploadProgress > 0 && uploadProgress < 100 ? `Uploading — ${uploadProgress}%` : 'Processing — extracting features & scoring...')
            : `Upload & analyze ${files.length > 1 ? `(${files.length} files)` : ''}`}
        </button>
      </form>

      {conflicts.length > 0 && (
        <div className="card p-5 mt-5 space-y-3 border-brand-orange/30">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-brand-orange" />
              <h3 className="font-display font-semibold dark:text-dark-text">
                {conflicts.length} file{conflicts.length === 1 ? '' : 's'} need{conflicts.length === 1 ? 's' : ''} confirmation
              </h3>
            </div>
            {conflicts.length > 1 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => resolveAllConflicts('confirm')}
                  disabled={loading}
                  className="text-xs font-semibold px-3 py-1.5 rounded-md bg-brand-orange text-white hover:bg-brand-orange/90 disabled:opacity-60"
                >
                  Resolve all &amp; analyze {conflicts.length}/{conflicts.length}
                </button>
                <button
                  type="button"
                  onClick={() => resolveAllConflicts('skip')}
                  disabled={loading}
                  className="text-xs font-semibold px-3 py-1.5 rounded-md border border-line dark:border-dark-border text-ink/60 dark:text-dark-muted"
                >
                  Skip all
                </button>
              </div>
            )}
          </div>
          {conflicts.map((c) => (
            <div key={c.filename} className="rounded-lg px-3 py-2.5 text-sm border border-brand-orange/25 bg-brand-orange/5">
              <div className="flex items-center gap-2">
                <p className="font-medium text-ink/80 dark:text-dark-text">{c.filename}</p>
                <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                  c.conflict_type === 'new_session' ? 'bg-teal-100 text-teal-700' : 'bg-brand-orange/15 text-brand-orange'
                }`}>
                  {c.conflict_type === 'new_session' ? 'New occasion' : 'Exact match'}
                </span>
              </div>
              <p className="text-xs text-ink/60 dark:text-dark-muted mt-1">{c.warning}</p>
              <div className="flex items-center gap-2 mt-2.5">
                <button
                  type="button"
                  onClick={() => resolveConflict(c, 'confirm')}
                  disabled={loading}
                  className="text-xs font-semibold px-2.5 py-1.5 rounded-md bg-brand-orange text-white hover:bg-brand-orange/90 disabled:opacity-60"
                >
                  {c.conflict_type === 'new_session' ? 'Add to existing data' : 'Replace existing recording'}
                </button>
                <button
                  type="button"
                  onClick={() => resolveConflict(c, 'skip')}
                  disabled={loading}
                  className="text-xs font-semibold px-2.5 py-1.5 rounded-md border border-line dark:border-dark-border text-ink/60 dark:text-dark-muted"
                >
                  Skip this file
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeSubjectId && (
        <div className="card p-5 mt-5">
          <h3 className="font-display font-semibold text-sm mb-3 dark:text-dark-text">
            Previously uploaded sessions {isAdmin ? `for ${formatSubjectId(activeSubjectId)}` : ''}
          </h3>
          {priorSessionsLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-brand-red" /></div>
          ) : priorSessions.length === 0 ? (
            <p className="text-xs text-ink/65 dark:text-dark-muted">No sessions recorded yet.</p>
          ) : (
            <ul className="space-y-2 mt-2">
              {priorSessions.map((s) => (
                <li key={s._id} className="flex items-center justify-between gap-3 bg-paper dark:bg-dark-surface rounded-lg px-3 py-2.5 border border-line/50 dark:border-dark-border">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink/80 dark:text-dark-text capitalize truncate">
                      {s.activity === 'cog' ? 'Cognitive task' : s.activity}
                      <span className="font-normal text-ink/65 dark:text-dark-muted"> — {new Date(s.recorded_at).toLocaleString()}</span>
                    </p>
                    <p className="text-xs text-ink/70 dark:text-dark-muted">{s.window_count ?? '—'} windows recorded</p>
                  </div>
                  {confirmDeleteId === s._id ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-danger font-medium">Delete permanently?</span>
                      <button type="button" onClick={() => confirmDelete(s._id)} disabled={deleteBusyId === s._id} className="text-xs font-semibold px-2.5 py-1 rounded-md bg-danger text-white hover:bg-danger/90 disabled:opacity-60">
                        {deleteBusyId === s._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Confirm'}
                      </button>
                      <button type="button" onClick={() => setConfirmDeleteId(null)} className="text-xs font-semibold px-2.5 py-1 rounded-md border border-line dark:border-dark-border text-ink/60 dark:text-dark-muted">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setConfirmDeleteId(s._id)} className="text-ink/60 hover:text-danger shrink-0 p-1.5" title="Delete this session's CSV data">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {result && (
        <div className="card p-5 mt-5 space-y-3">
          <div className="flex items-center gap-2">
            {result.failed === 0
              ? <CheckCircle2 className="w-5 h-5 text-success" />
              : <AlertCircle className="w-5 h-5 text-warning" />}
            <h3 className="font-display font-semibold dark:text-dark-text">
              {result.succeeded}/{result.total_files} file{result.total_files === 1 ? '' : 's'} processed successfully
            </h3>
          </div>
          <div className="space-y-2">
            {result.files.filter((f) => !f.requires_confirmation).map((f, i) => (
              <div key={i} className={`rounded-lg px-3 py-2.5 text-sm border ${
                f.skipped_identical ? 'border-line dark:border-dark-border bg-paper dark:bg-dark-surface'
                  : f.success ? 'border-success/20 bg-success/5' : 'border-danger/20 bg-danger/5'
              }`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-ink/75 dark:text-dark-text truncate">{f.filename}</span>
                  {f.skipped_identical
                    ? <span className="text-xs text-ink/70 dark:text-dark-muted font-mono capitalize shrink-0">{f.activity} · unchanged</span>
                    : f.success
                      ? <span className="text-xs text-success font-mono capitalize shrink-0">{f.activity} · {f.result?.predicted_risk_class}</span>
                      : <span className="text-xs text-danger shrink-0">Failed</span>}
                </div>
                {!f.success && <p className="text-xs text-ink/80 dark:text-dark-muted mt-1">{f.error}</p>}
                {f.skipped_identical && <p className="text-xs text-ink/70 dark:text-dark-muted mt-1">{f.warning || 'Identical data already on file — skipped.'}</p>}
                {f.success && !f.skipped_identical && (
                  <p className="text-xs text-ink/70 dark:text-dark-muted mt-1">
                    {f.result.windows_created} windows · {f.result.insights_created} insights · Risk {formatScore(f.result.risk_score)}
                  </p>
                )}
              </div>
            ))}
          </div>
          {result.succeeded > 0 && (
            <button onClick={() => navigate(`/app/subjects/${activeSubjectId}`)} className="btn-secondary">
              View {formatSubjectId(activeSubjectId)}'s dashboard
            </button>
          )}
        </div>
      )}
    </div>
  )
}