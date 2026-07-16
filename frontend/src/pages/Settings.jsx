import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shield, Database, Moon, Sun, Download, Trash2, Info, Loader2, UserX, CheckCircle2, RefreshCw, Clock, FileText } from 'lucide-react'
import { useTheme } from '../context/ThemeContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { Endpoints } from '../lib/api.js'
import { formatSubjectId } from '../lib/subjectId.js'
import { notifyDataChanged, onDataChanged } from '../lib/syncBus.js'

// How long the exit animation gets to play before the row is actually
// dropped from the list — long enough to read as intentional, short
// enough to still feel snappy.
const REMOVE_ANIMATION_MS = 320

// Shared delete workflow for both "Delete session data" (a normal user's
// own sessions) and the admin "Recently uploaded sessions" panel. Deleting
// a session isn't instant server-side — it also recalibrates the risk
// model on the remaining data (see DELETE /sessions/:id in the backend) —
// so this gives immediate feedback the moment the click happens, keeps
// that feedback visible for the entire recalibration window, guarantees a
// toast fires on both success and failure, and disables only the row being
// deleted so nothing else on the page freezes up.
//
// Deletes are processed ONE AT A TIME through a real queue, not fired off
// in parallel. Two reasons: the backend refits and bulk-rewrites the whole
// risk model on every delete with no locking between overlapping runs, so
// truly concurrent deletes could race each other server-side; and on the
// UI side, a second click while the first delete was still in flight used
// to just overwrite the single "which one is deleting" id, leaving the
// first card's row rendering nothing useful mid-request. Clicking a second
// delete now visibly queues it — a calm "waiting" state, not a spinner —
// until the one ahead of it actually finishes.
function useSessionDeletion({ setSessions, toast, deleteFn, confirmMessage, notifySource, successMessage = 'Session deleted.', errorFallback = 'Could not delete this session.' }) {
  const [activeId, setActiveId] = useState(null)
  const [queuedIds, setQueuedIds] = useState(() => new Set())
  const [removingIds, setRemovingIds] = useState(() => new Set())
  const queueRef = useRef([])
  const busyRef = useRef(false)

  const runNext = () => {
    if (busyRef.current) return
    const session = queueRef.current.shift()
    if (!session) return
    busyRef.current = true
    setQueuedIds((prev) => { const next = new Set(prev); next.delete(session._id); return next })
    setActiveId(session._id)

    ;(async () => {
      try {
        await deleteFn(session)
        toast?.success(successMessage)
        notifyDataChanged({ source: notifySource })
        setActiveId(null)
        setRemovingIds((prev) => new Set(prev).add(session._id))
        setTimeout(() => {
          setSessions((prev) => prev.filter((s) => s._id !== session._id))
          setRemovingIds((prev) => { const next = new Set(prev); next.delete(session._id); return next })
        }, REMOVE_ANIMATION_MS)
      } catch (err) {
        toast?.error(err.response?.data?.detail || errorFallback)
        setActiveId(null)
      } finally {
        busyRef.current = false
        runNext()
      }
    })()
  }

  const handleDelete = (session) => {
    if (activeId === session._id || queuedIds.has(session._id) || removingIds.has(session._id)) return
    if (!window.confirm(confirmMessage(session))) return
    queueRef.current.push(session)
    setQueuedIds((prev) => new Set(prev).add(session._id))
    runNext()
  }

  return { deletingId: activeId, removingIds, queuedIds, handleDelete }
}

// Presentational card shared by both delete flows. Three distinct states,
// each reads differently on purpose: queued rows stay calm (nothing is
// actually happening to them yet), the active row shows real progress
// feedback for the whole recalibration window, and a finished row
// fades/collapses out instead of just vanishing from the grid.
function DeletableSessionCard({ tone = 'danger', isDeleting, isQueued, isRemoving, onDelete, title, subtitle, windowCount }) {
  const toneClasses = tone === 'danger'
    ? 'border-danger/20 dark:border-red-900/30 bg-red-50/40 dark:bg-dark-surface/60'
    : 'border-line/70 dark:border-dark-border bg-paper dark:bg-dark-surface/60'
  const footerBorder = tone === 'danger' ? 'border-danger/10 dark:border-dark-border/60' : 'border-line/50 dark:border-dark-border/60'

  return (
    <div
      className={`relative rounded-xl border p-3.5 text-sm overflow-hidden transition-all duration-300 ease-out ${toneClasses}
        ${isRemoving ? 'opacity-0 scale-95 max-h-0 !p-0 !border-0 pointer-events-none' : 'opacity-100 max-h-56'}
        ${isDeleting ? 'opacity-70' : ''} ${isQueued ? 'opacity-80' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {title}
          {subtitle}
        </div>
        <button
          onClick={onDelete}
          disabled={isDeleting || isQueued || isRemoving}
          className="shrink-0 text-danger dark:text-red-400 hover:bg-danger/10 p-1.5 rounded-md disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          title="Delete this session"
        >
          {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : isQueued ? <Clock className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
        </button>
      </div>
      <div className={`flex items-center justify-between mt-3 pt-2.5 border-t ${footerBorder}`}>
        <span className="text-xs text-ink/70 dark:text-dark-muted">{windowCount ?? '\u2014'} windows</span>
        {isDeleting ? (
          <span className="flex items-center gap-1.5 text-xs text-brand-red font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-red animate-pulse" /> Deleting & recalibrating…
          </span>
        ) : isQueued ? (
          <span className="flex items-center gap-1.5 text-xs text-ink/60 dark:text-dark-muted font-medium">
            <Clock className="w-3 h-3" /> Waiting for the current deletion to finish…
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-success font-medium"><CheckCircle2 className="w-3.5 h-3.5" /> Processed</span>
        )}
      </div>
      {isDeleting && (
        <div className="absolute left-0 bottom-0 h-0.5 w-full bg-danger/10 overflow-hidden">
          <div className="h-full w-1/3 bg-danger animate-indeterminate" />
        </div>
      )}
    </div>
  )
}

export default function Settings() {
  const { dark, toggle } = useTheme()
  const { user, logout } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const isAdmin = user?.role === 'admin'

  // Admin's system-level tools (recalibrate model, recent uploads) render
  // as an extra section further down this same page now — Settings is no
  // longer redirected away for admins (that redirect was the bug where
  // clicking "Settings" landed on Admin User Management instead).

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h2 className="text-2xl font-display font-semibold mb-1 dark:text-dark-text">Settings</h2>
        <p className="text-sm text-ink/80 dark:text-dark-muted">Workspace preferences for this account.</p>
      </div>

      {isAdmin && <SystemPanel toast={toast} />}

      {/* Appearance */}
      <div className="card p-5">
        <SectionHeader icon={dark ? Moon : Sun} title="Appearance" />
        <div className="flex items-center justify-between py-2.5">
          <div>
            <p className="text-sm font-bold text-ink dark:text-dark-text">Dark mode</p>
            <p className="text-xs text-ink/75 dark:text-dark-muted mt-0.5">Switch between light and dark interface themes.</p>
          </div>
          <button
            onClick={() => { toggle(); toast?.success('Settings saved.') }}
            aria-pressed={dark}
            className={`w-11 h-6 rounded-full shrink-0 transition-colors duration-200 relative ${dark ? 'bg-brand-red' : 'bg-gray-300'}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${dark ? 'translate-x-5' : 'translate-x-0'}`}
            />
          </button>
        </div>
      </div>

      {/* Data Export */}
      <div className="card p-5">
        <SectionHeader icon={Download} title="Data & Export" />
        <p className="text-sm text-ink/65 dark:text-dark-muted leading-relaxed mb-4">
          Export your cohort data for offline analysis or backup.
        </p>
        <div className="flex flex-wrap gap-3">
          <button className="btn-secondary text-sm px-4 py-2 flex items-center gap-2">
            <Download className="w-4 h-4" /> Export all subjects (CSV)
          </button>
          <button className="btn-secondary text-sm px-4 py-2 flex items-center gap-2">
            <Download className="w-4 h-4" /> Export session data (JSON)
          </button>
        </div>
      </div>

      {/* Data & Model */}
      <div className="card p-5">
        <SectionHeader icon={Database} title="Data & Model" />
        <Row label="Database" value="MongoDB Atlas — CardioEQ" />
        <Row label="Risk model" value="Unsupervised — Gaussian Mixture clustering + Isolation Forest anomaly detection" />
        <Row label="Reference ranges" value="Cohort-empirical (unsupervised-healthy windows, no clinician labels)" />
        <Row label="Model version" value="v3.0.0 — fully unsupervised, activity-normalized" />
      </div>

      {/* Edit profile lives on the dedicated Profile page (name/email editing
          for every account, admin included) — this card used to duplicate
          that exact same form here too, so it's removed rather than kept
          in two places that could drift out of sync. */}

      {/* Delete Session Data — only the current user's own uploaded
          sessions are ever listed here (spec B.5); admins delete/manage
          other participants' sessions from the Cohort Overview / Upload
          Recording (admin) flows instead. */}
      {!isAdmin && <DeleteSessionData user={user} toast={toast} />}

      {/* Delete Account (spec 5) — normal users only; the admin account
          can't be deleted from here (backend blocks it too). */}
      {!isAdmin && <DeleteAccount toast={toast} logout={logout} navigate={navigate} />}

      {/* Privacy & Compliance */}
      <div className="card p-5">
        <SectionHeader icon={Shield} title="Privacy & Compliance" />
        <div className="flex items-start gap-2 p-3 bg-brand-orange/5 dark:bg-orange-900/10 border border-brand-orange/20 dark:border-orange-900/30 rounded-lg mb-3">
          <Info className="w-4 h-4 text-brand-orange mt-0.5 shrink-0" />
          <p className="text-xs text-ink/70 dark:text-dark-muted leading-relaxed">
            This is a research-grade analytics deployment, not a certified medical device.
          </p>
        </div>
        <p className="text-sm text-ink/60 dark:text-dark-muted leading-relaxed">
          Before handling real patient data, review HIPAA/local health-data regulations and ensure your
          MongoDB Atlas cluster, JWT secret, and API keys are configured for a production-grade
          security posture (network access lists, encryption at rest, rotated credentials).
        </p>
      </div>
    </div>
  )
}

function DeleteAccount({ toast, logout, navigate }) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await Endpoints.deleteAccount()
      toast?.success('Account deleted.')
      logout()
      navigate('/sign-in')
    } catch (err) {
      toast?.error(err.response?.data?.detail || 'Could not delete your account.')
      setDeleting(false)
    }
  }

  return (
    <div className="card p-5 border-danger/30 dark:border-red-900/40">
      <SectionHeader icon={UserX} title="Delete account" />
      <p className="text-sm text-ink/65 dark:text-dark-muted leading-relaxed mb-4">
        Permanently deletes your login account. This can't be undone — you'll be signed out and returned to the login page.
      </p>
      {!confirming ? (
        <button onClick={() => setConfirming(true)} className="btn-secondary text-sm px-4 py-2 text-danger dark:text-red-400 border-danger/30">
          Delete my account
        </button>
      ) : (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-semibold text-danger">Are you sure? This is permanent.</span>
          <button onClick={handleDelete} disabled={deleting} className="text-xs font-semibold px-3 py-1.5 rounded-md bg-danger text-white hover:bg-danger/90 disabled:opacity-60 flex items-center gap-1.5">
            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Yes, delete my account
          </button>
          <button onClick={() => setConfirming(false)} disabled={deleting} className="text-xs font-semibold px-3 py-1.5 rounded-md border border-line dark:border-dark-border text-ink/60 dark:text-dark-muted">
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

function DeleteSessionData({ user, toast }) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const subjectId = user?.subject_id

  useEffect(() => {
    if (!subjectId) { setLoading(false); return }
    Endpoints.getSessions(subjectId)
      .then((res) => setSessions(res.data.sessions || []))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false))
  }, [subjectId])

  const { deletingId, removingIds, queuedIds, handleDelete } = useSessionDeletion({
    setSessions,
    toast,
    notifySource: 'delete-session',
    confirmMessage: (session) => `Delete your ${session.activity} session from ${new Date(session.recorded_at).toLocaleDateString()}? This can't be undone.`,
    deleteFn: (session) => Endpoints.deleteSession(subjectId, session._id),
  })

  return (
    <div className="card p-5 border-danger/30 dark:border-red-900/40">
      <SectionHeader icon={Trash2} title="Delete session data" />
      <p className="text-sm text-ink/65 dark:text-dark-muted leading-relaxed mb-4">
        Only sessions you've actually uploaded are listed here. Deleting a session is permanent.
      </p>
      {loading ? (
        <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-brand-red" /></div>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-ink/70 dark:text-dark-muted italic">No uploaded sessions yet.</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {sessions.map((s) => (
            <DeletableSessionCard
              key={s._id}
              tone="danger"
              isDeleting={deletingId === s._id}
              isQueued={queuedIds.has(s._id)}
              isRemoving={removingIds.has(s._id)}
              onDelete={() => handleDelete(s)}
              windowCount={s.window_count}
              title={<span className="font-semibold text-ink dark:text-dark-text capitalize">{s.activity}</span>}
              subtitle={
                <p className="text-xs text-ink/70 dark:text-dark-muted mt-1">
                  {formatSubjectId(subjectId)} · {s.recorded_at ? new Date(s.recorded_at).toLocaleDateString() : 'unknown date'}
                </p>
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SectionHeader({ icon: Icon, title }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Icon className="w-4 h-4 text-brand-red" />
      <h3 className="font-display font-semibold text-base dark:text-dark-text">{title}</h3>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between py-2 text-sm border-t border-line/60 dark:border-dark-border first:border-t-0 first:pt-0">
      <span className="text-ink/80 dark:text-dark-muted">{label}</span>
      <span className="font-mono text-xs text-ink/75 dark:text-dark-text text-right max-w-[60%]">{value}</span>
    </div>
  )
}

// Admin-only system tools: recalibrate the live model, and review/delete
// whatever came in with the single most recent upload. Lives on Settings
// now (not Admin User Management) — Admin User Management stays scoped
// to adding/removing participants; this is workspace/system config.
function SystemPanel({ toast }) {
  const [retraining, setRetraining] = useState(false)
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  // Tracks whether we've completed the first fetch. loadSessions() re-runs
  // on every onDataChanged event (uploads, deletes, retrains — anywhere in
  // the app), including the one this panel's own delete fires the instant
  // a row finishes. Without this flag every background refresh flips
  // `loading` back to true, which swaps the entire grid for the centered
  // spinner — wiping out any row still mid-delete or queued, even though
  // nothing about that row's own state changed. Only the very first load
  // should look like a full loading state; every refresh after that
  // updates the grid quietly in place.
  const hasLoadedRef = useRef(false)

  const loadSessions = () => {
    if (!hasLoadedRef.current) setLoading(true)
    Endpoints.adminRecentSessions(25)
      .then((res) => setSessions(res.data.sessions || []))
      .catch(() => toast?.error('Could not load recent uploads.'))
      .finally(() => { setLoading(false); hasLoadedRef.current = true })
  }

  useEffect(loadSessions, [])
  useEffect(() => onDataChanged(loadSessions), [])

  const handleRetrain = async () => {
    setRetraining(true)
    try {
      const res = await Endpoints.adminRetrainPipeline()
      notifyDataChanged({ source: 'retrain' })
      toast?.success(
        `Model retrained on ${res.data.n_windows_used} windows across ${res.data.n_subjects_rescored} subjects — `
        + `${res.data.n_sessions_rescored} session(s) rescored.`
      )
    } catch (err) {
      toast?.error(err.response?.data?.detail || 'Could not retrain the pipeline.')
    } finally {
      setRetraining(false)
    }
  }

  const { deletingId, removingIds, queuedIds, handleDelete: handleDeleteSession } = useSessionDeletion({
    setSessions,
    toast,
    notifySource: 'admin-delete-session',
    confirmMessage: (session) => {
      const label = `${formatSubjectId(session.subject_id)}'s ${session.activity} session`
      return `Delete ${label} from ${session.recorded_at ? new Date(session.recorded_at).toLocaleDateString() : 'this date'}? This can't be undone.`
    },
    deleteFn: (session) => Endpoints.deleteSession(session.subject_id, session._id),
  })

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <SectionHeader icon={Database} title="Data & model" />
        <button
          className="btn-ghost text-sm flex items-center gap-2 text-brand-red dark:text-red-400 hover:bg-red-50 dark:hover:bg-dark-surface disabled:opacity-60"
          onClick={handleRetrain}
          disabled={retraining}
        >
          {retraining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          {retraining ? 'Refitting model on live cohort data\u2026' : 'Recalibrate risk model'}
        </button>
        <p className="text-xs text-ink/60 dark:text-dark-muted mt-1.5">
          Refits the unsupervised model on every recording currently in the database (not just the original
          seed cohort), then rescores every subject. Takes a few seconds.
        </p>
      </div>

      <div className="card p-5">
        <SectionHeader icon={Clock} title="Recently uploaded sessions" />
        <p className="text-sm text-ink/65 dark:text-dark-muted mb-4 -mt-2.5">
          Every session uploaded in the last 24 hours, most recent first — each with the subject it
          belongs to and the file it came from. Updates immediately after each upload or delete, no
          refresh needed.
        </p>
        {loading ? (
          <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-brand-red" /></div>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-ink/60 dark:text-dark-muted italic">No recent uploads. Once someone uploads a recording, it'll show up here.</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3 max-h-[28rem] overflow-y-auto pr-0.5">
            {sessions.map((s) => (
              <DeletableSessionCard
                key={s._id}
                tone="neutral"
                isDeleting={deletingId === s._id}
                isQueued={queuedIds.has(s._id)}
                isRemoving={removingIds.has(s._id)}
                onDelete={() => handleDeleteSession(s)}
                windowCount={s.window_count}
                title={
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-ink dark:text-dark-text">{formatSubjectId(s.subject_id)}</span>
                    <span className="text-ink/70 dark:text-dark-muted capitalize">{s.activity}</span>
                  </div>
                }
                subtitle={
                  <>
                    <div className="flex items-center gap-1 mt-1 text-xs text-ink/70 dark:text-dark-muted">
                      <FileText className="w-3 h-3 shrink-0" />
                      <span className="truncate" title={s.source_filename || undefined}>
                        {s.source_filename || 'Filename not recorded (uploaded before this was tracked)'}
                      </span>
                    </div>
                    <p className="text-xs text-ink/60 dark:text-dark-muted mt-1">
                      {s.recorded_at ? new Date(s.recorded_at).toLocaleString() : '\u2014'}
                    </p>
                  </>
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
