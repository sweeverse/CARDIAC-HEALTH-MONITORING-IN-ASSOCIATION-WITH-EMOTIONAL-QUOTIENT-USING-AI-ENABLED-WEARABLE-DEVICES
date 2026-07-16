import { useEffect, useMemo, useState } from 'react'
import { UserPlus, Trash2, Loader2, ShieldCheck, Search, X, Mail, User, Lock, AlertTriangle, HeartPulse, Activity, Ruler, Weight, Cake } from 'lucide-react'
import { Endpoints } from '../lib/api.js'
import { useToast } from '../context/ToastContext.jsx'
import { formatSubjectId, subjectIdMatches } from '../lib/subjectId.js'
import { notifyDataChanged } from '../lib/syncBus.js'

const emptyForm = { full_name: '', email: '', password: '', age: '', height_cm: '', weight_kg: '' }

// Admin User Management (Task 13): Add Subject button, Delete Subject with
// a confirmation dialog, and an immediate refresh after either — no page
// reload needed, since both actions just re-fetch the user list from
// whatever's now in Mongo (Task 4's backend already commits synchronously).
export default function AdminUserManagement() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [deleteBusyId, setDeleteBusyId] = useState(null)
  const [selectedUser, setSelectedUser] = useState(null)
  const toast = useToast()

  const load = () => {
    setLoading(true)
    Endpoints.adminListUsers()
      .then((res) => setUsers(res.data.users || []))
      .catch(() => toast?.error('Could not load the user list.'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const filtered = useMemo(() => {
    return users
      .filter((u) => !query || subjectIdMatches(u.subject_id, query) || u.full_name?.toLowerCase().includes(query.toLowerCase()) || u.email?.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => formatSubjectId(a.subject_id || '').localeCompare(formatSubjectId(b.subject_id || '')))
  }, [users, query])

  const submitCreate = async (e) => {
    e.preventDefault()
    setFormError('')
    if (!form.full_name.trim() || !form.email.trim() || form.password.length < 8) {
      setFormError('Name and email are required, and password must be at least 8 characters.')
      return
    }
    setSaving(true)
    try {
      const payload = {
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        password: form.password,
        age: form.age === '' ? null : Number(form.age),
        height_cm: form.height_cm === '' ? null : Number(form.height_cm),
        weight_kg: form.weight_kg === '' ? null : Number(form.weight_kg),
      }
      const res = await Endpoints.adminCreateUser(payload)
      toast?.success(`${formatSubjectId(res.data.subject_id)} created for ${payload.full_name}.`)
      setForm(emptyForm)
      setShowAddForm(false)
      notifyDataChanged({ source: 'admin-create-user' })
      load() // immediate refresh — no manual reload needed (Task 13)
    } catch (err) {
      setFormError(err.response?.data?.detail || 'Could not create this user.')
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async (userId) => {
    setDeleteBusyId(userId)
    try {
      const res = await Endpoints.adminDeleteUser(userId)
      setUsers((prev) => prev.filter((u) => u._id !== userId))
      setConfirmDeleteId(null)
      setSelectedUser((cur) => (cur?._id === userId ? null : cur))
      notifyDataChanged({ source: 'admin-delete-user' })
      toast?.success(
        `${formatSubjectId(res.data.deleted_subject_id || '')} deleted — ${res.data.sessions_deleted} recording(s), `
        + `${res.data.windows_deleted} window(s), and ${res.data.insights_deleted} insight(s) removed.`
      )
    } catch (err) {
      toast?.error(err.response?.data?.detail || 'Could not delete this user.')
    } finally {
      setDeleteBusyId(null)
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-display font-semibold dark:text-dark-text flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-brand-red" /> Admin User Management
          </h2>
          <p className="text-sm text-ink/80 dark:text-dark-muted mt-1">
            Add participants or permanently remove a participant and every piece of their data.
          </p>
        </div>
        {!showAddForm && (
          <button onClick={() => { setShowAddForm(true); setFormError('') }} className="btn-primary shrink-0">
            <UserPlus className="w-4 h-4" /> Add Subject
          </button>
        )}
      </div>

      {showAddForm && (
        <form onSubmit={submitCreate} className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-semibold text-base dark:text-dark-text">New subject</h3>
            <button type="button" onClick={() => { setShowAddForm(false); setForm(emptyForm); setFormError('') }} className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-dark-surface text-ink/75 dark:text-dark-muted">
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-ink/70 dark:text-dark-muted -mt-2">
            A Subject Number is auto-assigned — it's never typed by hand.
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="label-field flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> Full name</label>
              <input className="input-field" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Jane Doe" />
            </div>
            <div>
              <label className="label-field flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> Email</label>
              <input type="email" className="input-field" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jane@example.com" />
            </div>
            <div>
              <label className="label-field flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> Temporary password</label>
              <input type="password" className="input-field" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 8 characters" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="label-field">Age</label>
                <input type="number" className="input-field" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} placeholder="29" />
              </div>
              <div>
                <label className="label-field">Height (cm)</label>
                <input type="number" className="input-field" value={form.height_cm} onChange={(e) => setForm({ ...form, height_cm: e.target.value })} placeholder="170" />
              </div>
              <div>
                <label className="label-field">Weight (kg)</label>
                <input type="number" className="input-field" value={form.weight_kg} onChange={(e) => setForm({ ...form, weight_kg: e.target.value })} placeholder="65" />
              </div>
            </div>
          </div>
          {formError && (
            <div className="flex items-start gap-2 text-sm text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {formError}
            </div>
          )}
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />} Create subject
          </button>
        </form>
      )}

      <div className="relative max-w-sm">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink/60 dark:text-dark-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, email, or Subject Number"
          className="input-field pl-9 w-full"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-brand-red" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-ink/70 dark:text-dark-muted italic">No users match "{query}".</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((u) => (
            <div
              key={u._id}
              onClick={() => setSelectedUser(u)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') setSelectedUser(u) }}
              className="card p-4 text-left cursor-pointer hover:shadow-pop hover:-translate-y-0.5 transition-all"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono font-bold text-base text-ink dark:text-dark-text">{formatSubjectId(u.subject_id || '—')}</span>
                {confirmDeleteId === u._id ? (
                  <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => confirmDelete(u._id)}
                      disabled={deleteBusyId === u._id}
                      className="text-[11px] font-semibold px-2 py-1 rounded-md bg-danger text-white hover:bg-danger/90 disabled:opacity-60"
                    >
                      {deleteBusyId === u._id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Confirm'}
                    </button>
                    <button onClick={() => setConfirmDeleteId(null)} className="text-[11px] font-semibold px-2 py-1 rounded-md border border-line dark:border-dark-border text-ink/60 dark:text-dark-muted">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(u._id) }}
                    className="p-1.5 rounded-md text-ink/60 hover:text-danger hover:bg-danger/5"
                    title="Delete this subject and all their data"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              <p className="text-sm font-medium text-ink/80 dark:text-dark-text truncate">{u.full_name}</p>
              <p className="text-xs text-ink/75 dark:text-dark-muted truncate">{u.email}</p>
              {confirmDeleteId === u._id && (
                <p className="text-[11px] text-danger mt-2 leading-snug">
                  This permanently deletes their login and every recording, insight, and score. This can't be undone.
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {selectedUser && (
        <SubjectDetailModal
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          onDelete={confirmDelete}
          deleteBusy={deleteBusyId === selectedUser._id}
          toast={toast}
        />
      )}
    </div>
  )
}

// Clicking a subject card opens this — a manage/detail view with the
// subject's account info, their recording activity, and a clearly visible
// "Delete subject" action (with its own confirm step, separate from the
// quick trash icon on the card). Reuses the same adminDeleteUser cascade
// as the card's icon, just surfaced somewhere more discoverable than a
// small icon in the corner.
function SubjectDetailModal({ user, onClose, onDelete, deleteBusy, toast }) {
  const [subject, setSubject] = useState(null)
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.allSettled([
      Endpoints.getSubject(user.subject_id),
      Endpoints.getSessions(user.subject_id),
    ]).then(([subj, sess]) => {
      if (cancelled) return
      if (subj.status === 'fulfilled') setSubject(subj.value.data)
      if (sess.status === 'fulfilled') setSessions(sess.value.data.sessions || [])
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [user.subject_id])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const demo = subject?.demographics || {}

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="card w-full max-w-lg max-h-[85vh] overflow-y-auto p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-line/60 dark:border-dark-border sticky top-0 bg-surface dark:bg-dark-surface">
          <div>
            <p className="font-mono font-bold text-lg text-ink dark:text-dark-text">{formatSubjectId(user.subject_id)}</p>
            <p className="text-xs text-ink/75 dark:text-dark-muted">{user.full_name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-dark-card text-ink/75 dark:text-dark-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-brand-red" /></div>
          ) : (
            <>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-ink/70 dark:text-dark-muted mb-2">Account</p>
                <div className="space-y-1.5">
                  <DetailRow icon={User} label="Full name" value={user.full_name} />
                  <DetailRow icon={Mail} label="Email" value={user.email} />
                  <DetailRow icon={Cake} label="Age" value={demo.age ? `${demo.age}y` : '\u2014'} />
                  <DetailRow icon={Ruler} label="Height" value={demo.height_cm ? `${demo.height_cm} cm` : '\u2014'} />
                  <DetailRow icon={Weight} label="Weight" value={demo.weight_kg ? `${demo.weight_kg} kg` : '\u2014'} />
                  <DetailRow icon={Activity} label="BMI" value={demo.bmi ?? '\u2014'} />
                </div>
              </div>

              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-ink/70 dark:text-dark-muted mb-2">
                  Recordings ({sessions.length})
                </p>
                {sessions.length === 0 ? (
                  <p className="text-sm text-ink/70 dark:text-dark-muted italic">No sessions uploaded yet.</p>
                ) : (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {sessions.map((s) => (
                      <div key={s._id} className="flex items-center justify-between text-xs bg-paper dark:bg-dark-surface/60 rounded-lg px-3 py-2">
                        <span className="font-semibold text-ink dark:text-dark-text capitalize flex items-center gap-1.5">
                          <HeartPulse className="w-3 h-3 text-brand-red" /> {s.activity}
                        </span>
                        <span className="text-ink/70 dark:text-dark-muted">{s.window_count ?? '\u2014'} windows</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-danger/20">
                <p className="text-xs font-bold uppercase tracking-wide text-danger mb-2">Danger zone</p>
                {!confirming ? (
                  <button
                    onClick={() => setConfirming(true)}
                    className="w-full flex items-center justify-center gap-2 text-sm font-semibold text-white bg-danger hover:bg-danger/90 px-4 py-2.5 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" /> Delete subject
                  </button>
                ) : (
                  <div className="space-y-2.5">
                    <p className="text-xs text-danger leading-snug">
                      This permanently deletes {formatSubjectId(user.subject_id)}'s login, every recording, insight, and
                      score. This can't be undone.
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onDelete(user._id)}
                        disabled={deleteBusy}
                        className="flex-1 flex items-center justify-center gap-2 text-sm font-semibold text-white bg-danger hover:bg-danger/90 px-4 py-2.5 rounded-lg disabled:opacity-60"
                      >
                        {deleteBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Yes, delete everything
                      </button>
                      <button
                        onClick={() => setConfirming(false)}
                        disabled={deleteBusy}
                        className="px-4 py-2.5 rounded-lg text-sm font-semibold border border-line dark:border-dark-border text-ink/60 dark:text-dark-muted"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function DetailRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center justify-between text-sm py-1">
      <span className="flex items-center gap-1.5 text-ink/80 dark:text-dark-muted">
        <Icon className="w-3.5 h-3.5" /> {label}
      </span>
      <span className="font-medium text-ink dark:text-dark-text">{value}</span>
    </div>
  )
}
