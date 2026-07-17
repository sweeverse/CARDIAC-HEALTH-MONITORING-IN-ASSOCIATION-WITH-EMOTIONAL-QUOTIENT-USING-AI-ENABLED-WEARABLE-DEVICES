import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { User, Mail, Ruler, Weight, Activity, LogOut, Loader2, ShieldCheck, Pencil, Check, X, Hash } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { Endpoints } from '../lib/api.js'
import { formatSubjectId } from '../lib/subjectId.js'

// Full profile management page (spec B.4): subject number, email, age,
// height, weight, auto-computed BMI, account info, and logout. Height and
// weight are ONLY ever managed here — Upload Recording never asks for them.
// Admin accounts are the exception: an administrator isn't a research
// subject, so their Profile page shows ONLY account information — no
// age/height/weight/BMI or any other participant-specific physiological
// metric (spec section 3).
export default function Profile() {
  const { user, setUser, logout } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const isAdmin = user?.role === 'admin'

  const [age, setAge] = useState(user?.age ?? '')
  const [heightCm, setHeightCm] = useState(user?.height_cm ?? '')
  const [weightKg, setWeightKg] = useState(user?.weight_kg ?? '')
  const [saving, setSaving] = useState(false)

  const bmi = (heightCm && weightKg)
    ? (Number(weightKg) / Math.pow(Number(heightCm) / 100, 2)).toFixed(1)
    : null

  const save = async () => {
    setSaving(true)
    try {
      const payload = {}
      if (age !== '') payload.age = Number(age)
      if (heightCm !== '') payload.height_cm = Number(heightCm)
      if (weightKg !== '') payload.weight_kg = Number(weightKg)
      const res = await Endpoints.updateMe(payload)
      setUser(res.data)
      toast?.success('Profile updated.')
    } catch (err) {
      toast?.error(err.response?.data?.detail || 'Could not update your profile.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h2 className="text-2xl font-display font-semibold mb-1 dark:text-dark-text">Profile</h2>
        <p className="text-sm text-ink/80 dark:text-dark-muted">
          {isAdmin ? 'Your administrator account information.' : 'Your account and physiological reference details.'}
        </p>
      </div>

      {/* Account Information */}
      <div className="card p-5">
        <SectionHeader icon={User} title="Account Information" />
        <div className="space-y-3">
          <EditableRow icon={User} label="Full Name" field="full_name" value={user?.full_name} user={user} setUser={setUser} toast={toast} />
          <EditableRow icon={Mail} label="Email Address" field="email" value={user?.email} type="email" user={user} setUser={setUser} toast={toast} />
          {!isAdmin && user?.subject_id && (
            <InfoRow icon={Hash} label="Subject Number" value={formatSubjectId(user.subject_id)} mono />
          )}
          {user?.role === 'admin' && (
            <div className="flex items-center gap-2 text-xs text-brand-red font-semibold pt-1">
              <ShieldCheck className="w-3.5 h-3.5" /> Administrator account
            </div>
          )}
        </div>
      </div>

      {/* Physiological Details — never shown to admin accounts (spec 3) */}
      {!isAdmin && (
      <div className="card p-5">
        <SectionHeader icon={Activity} title="Physiological Details" />
        <p className="text-xs text-ink/75 dark:text-dark-muted mb-4 leading-relaxed">
          These values are used to personalize your recordings automatically — you'll never be asked for
          height or weight again during Upload Recording.
        </p>
        <div className="grid sm:grid-cols-3 gap-3 mb-4">
          <Field label="Age (years)" value={age} onChange={setAge} type="number" />
          <Field label="Height (cm)" value={heightCm} onChange={setHeightCm} type="number" icon={Ruler} />
          <Field label="Weight (kg)" value={weightKg} onChange={setWeightKg} type="number" icon={Weight} />
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg bg-red-50/50 dark:bg-dark-surface/60 mb-4">
          <span className="text-sm font-semibold text-ink/70 dark:text-dark-muted">Body Mass Index (auto-calculated)</span>
          <span className="font-mono text-base font-bold text-brand-red">{bmi ?? '\u2014'}</span>
        </div>
        <button onClick={save} disabled={saving} className="btn-primary text-sm px-4 py-2 flex items-center gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Save changes
        </button>
      </div>
      )}

      {/* Logout */}
      <div className="card p-5">
        <button
          onClick={() => { logout(); navigate('/') }}
          className="w-full flex items-center justify-center gap-2 text-sm font-semibold text-danger dark:text-red-400 border border-danger/30 dark:border-red-900/50 px-4 py-2.5 rounded-lg hover:bg-danger/5 dark:hover:bg-red-950/30 transition-colors"
        >
          <LogOut className="w-4 h-4" /> Log out
        </button>
      </div>
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

function InfoRow({ icon: Icon, label, value, mono }) {
  return (
    <div className="flex items-center justify-between py-2 border-t border-line/60 dark:border-dark-border first:border-t-0 first:pt-0">
      <span className="flex items-center gap-2 text-sm text-ink/80 dark:text-dark-muted">
        <Icon className="w-3.5 h-3.5" /> {label}
      </span>
      <span className={`text-sm font-semibold text-ink dark:text-dark-text ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

// Click the pencil -> input replaces the value -> Save (check) / Cancel (x).
// Wired to PUT /api/auth/me (Endpoints.updateMe), same endpoint Settings'
// EditProfile block already uses, so both stay in sync. Validates locally
// before hitting the network; server-side errors (e.g. "email already in
// use") surface as an inline message, not just a toast.
function EditableRow({ icon: Icon, label, field, value, user, setUser, toast, type = 'text' }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const startEdit = () => {
    setDraft(value || '')
    setError('')
    setEditing(true)
  }

  const cancel = () => {
    setEditing(false)
    setError('')
  }

  const validate = (v) => {
    if (!v.trim()) return field === 'email' ? 'Email is required.' : 'Name is required.'
    if (field === 'email') {
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailPattern.test(v.trim())) return 'Enter a valid email address.'
    }
    return ''
  }

  const save = async () => {
    const trimmed = draft.trim()
    const err = validate(trimmed)
    if (err) { setError(err); return }
    if (trimmed === (value || '')) { setEditing(false); return }
    setSaving(true)
    setError('')
    try {
      const payload = { [field]: field === 'email' ? trimmed.toLowerCase() : trimmed }
      const res = await Endpoints.updateMe(payload)
      setUser(res.data)
      toast?.success(`${label} updated.`)
      setEditing(false)
    } catch (err) {
      setError(err.response?.data?.detail || `Could not update ${label.toLowerCase()}.`)
      toast?.error(err.response?.data?.detail || `Could not update ${label.toLowerCase()}.`)
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between py-2 border-t border-line/60 dark:border-dark-border first:border-t-0 first:pt-0 group">
        <span className="flex items-center gap-2 text-sm text-ink/80 dark:text-dark-muted">
          <Icon className="w-3.5 h-3.5" /> {label}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink dark:text-dark-text">{value || '\u2014'}</span>
          <button
            onClick={startEdit}
            className="p-1 rounded-md text-ink/55 hover:text-brand-red hover:bg-red-50 dark:hover:bg-dark-surface opacity-60 group-hover:opacity-100 transition-opacity"
            title={`Edit ${label.toLowerCase()}`}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="py-2 border-t border-line/60 dark:border-dark-border first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm text-ink/80 dark:text-dark-muted shrink-0">
          <Icon className="w-3.5 h-3.5" /> {label}
        </span>
        <div className="flex items-center gap-1.5 flex-1 justify-end min-w-0">
          <input
            autoFocus
            type={type}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }}
            disabled={saving}
            className="input-field !py-1.5 !text-sm max-w-[220px]"
          />
          <button onClick={save} disabled={saving} className="p-1.5 rounded-md text-success hover:bg-green-50 dark:hover:bg-dark-surface disabled:opacity-60" title="Save">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          </button>
          <button onClick={cancel} disabled={saving} className="p-1.5 rounded-md text-ink/65 hover:text-danger hover:bg-danger/5 disabled:opacity-60" title="Cancel">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-danger mt-1.5 text-right">{error}</p>}
    </div>
  )
}

function Field({ label, value, onChange, type, icon: Icon }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-ink/80 dark:text-dark-muted mb-1 flex items-center gap-1">
        {Icon ? <Icon className="w-3 h-3" /> : null} {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-field w-full"
        min={0}
      />
    </label>
  )
}
