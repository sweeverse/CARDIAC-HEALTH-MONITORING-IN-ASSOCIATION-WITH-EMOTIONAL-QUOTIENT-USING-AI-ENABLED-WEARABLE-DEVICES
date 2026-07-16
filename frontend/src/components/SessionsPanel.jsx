import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Loader2, CalendarClock, Layers, Users } from 'lucide-react'
import { Endpoints } from '../lib/api.js'
import { formatScore } from '../lib/format.js'
import { onDataChanged } from '../lib/syncBus.js'
import TimeSeriesPanel from './TimeSeriesPanel.jsx'
import PopulationPanel from './PopulationPanel.jsx'

const ACTIVITY_LABEL = { sit: 'Sit', walk: 'Walk', run: 'Run', cog: 'Cognitive task' }
const ACTIVITY_ORDER = ['sit', 'walk', 'run', 'cog']

// Groups the flat, per-activity session list the API returns into actual
// recording sessions — everything a person uploaded together in one sitting
// (up to 4 activity CSVs at once) shares a `session_batch_id` set by the
// backend at upload time (see routers/subjects.py), so that's the true
// grouping key. Falls back to `recorded_at`/`session_id` for any older rows
// that predate session_batch_id existing.
function groupIntoRecordingSessions(sessions) {
  const map = new Map()
  for (const s of sessions) {
    const key = s.session_batch_id || (s.recorded_at ? `t:${s.recorded_at}` : s.session_id)
    if (!map.has(key)) map.set(key, { key, recordedAt: s.recorded_at, activities: {} })
    const group = map.get(key)
    group.activities[s.activity] = s
    if (s.recorded_at && (!group.recordedAt || new Date(s.recorded_at) < new Date(group.recordedAt))) {
      group.recordedAt = s.recorded_at
    }
  }
  // Oldest first, so "Recording session 1" really is the first one this
  // subject ever had — newly uploaded sessions land at the bottom of the
  // list, matching how the collapsible stack is meant to grow.
  const groups = Array.from(map.values()).sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt))
  return groups.map((g, i) => ({ ...g, index: i + 1 }))
}

export default function SessionsPanel({ subjectId }) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openKeys, setOpenKeys] = useState(() => new Set())

  const groups = useMemo(() => groupIntoRecordingSessions(sessions), [sessions])

  const load = () => {
    setLoading(true); setError('')
    Endpoints.getSessions(subjectId)
      .then((res) => {
        const list = res.data.sessions || []
        setSessions(list)
        const grouped = groupIntoRecordingSessions(list)
        // First load: open only the most recent recording session by
        // default, so the page isn't a wall of collapsed headers. Later
        // reloads (e.g. after a new upload) leave whatever the person
        // already has open/closed alone.
        setOpenKeys((prev) => (prev.size === 0 && grouped.length > 0 ? new Set([grouped[grouped.length - 1].key]) : prev))
      })
      .catch(() => setError('Could not load this subject\'s sessions.'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [subjectId])
  useEffect(() => onDataChanged(load), [subjectId])

  const toggle = (key) => {
    setOpenKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-brand-red" /></div>
  if (error) return <div className="card p-6 text-sm text-danger">{error}</div>
  if (groups.length === 0) {
    return <div className="card p-6 text-sm text-ink/70 dark:text-dark-muted">No sessions uploaded yet for this subject.</div>
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink/60 dark:text-dark-muted flex items-center gap-1.5">
        <Layers className="w-3.5 h-3.5" /> {groups.length} recording session{groups.length === 1 ? '' : 's'} on file — expand
        any card to review its Walk, Sit, Run, and Cognitive Task time-series, plus how this subject compares to the cohort.
      </p>
      {groups.map((g) => (
        <RecordingSessionCard
          key={g.key}
          subjectId={subjectId}
          group={g}
          isOpen={openKeys.has(g.key)}
          onToggle={() => toggle(g.key)}
        />
      ))}
    </div>
  )
}

function RecordingSessionCard({ subjectId, group, isOpen, onToggle }) {
  const when = group.recordedAt ? new Date(group.recordedAt).toLocaleString() : '—'
  const presentActivities = ACTIVITY_ORDER.filter((a) => group.activities[a])
  const [activeTab, setActiveTab] = useState(presentActivities[0] || 'population')

  const scores = presentActivities.map((a) => group.activities[a].avg_risk_score).filter((v) => v != null)
  const avgRisk = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null
  const totalWindows = presentActivities.reduce((sum, a) => sum + (group.activities[a].window_count || 0), 0)

  const activeSession = activeTab !== 'population' ? group.activities[activeTab] : null

  return (
    <div className="card overflow-hidden p-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-paper dark:hover:bg-dark-surface transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <ChevronDown className={`w-4 h-4 shrink-0 text-ink/50 dark:text-dark-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          <div className="min-w-0">
            <p className="font-display font-semibold text-sm text-ink dark:text-dark-text">
              Recording session {group.index}
            </p>
            <p className="text-xs text-ink/60 dark:text-dark-muted flex items-center gap-1 mt-0.5">
              <CalendarClock className="w-3 h-3 shrink-0" /> {when} · {presentActivities.length} activit{presentActivities.length === 1 ? 'y' : 'ies'} · {totalWindows} windows
            </p>
          </div>
        </div>
        {avgRisk != null && (
          <span className="text-xs font-mono font-semibold text-brand-red shrink-0">
            Risk {formatScore(avgRisk)}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="border-t border-line/60 dark:border-dark-border px-5 py-5 space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            {ACTIVITY_ORDER.map((a) => {
              const present = !!group.activities[a]
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => setActiveTab(a)}
                  title={present ? undefined : 'Not recorded in this session — click to see details'}
                  className={`pill capitalize border transition-colors ${
                    activeTab === a
                      ? 'bg-brand-red text-white border-brand-red'
                      : present
                        ? 'bg-white dark:bg-dark-card text-ink/60 dark:text-dark-muted border-line dark:border-dark-border hover:border-brand-red/40'
                        : 'bg-white dark:bg-dark-card text-ink/35 dark:text-dark-muted/50 border-dashed border-line/70 dark:border-dark-border/70 hover:border-brand-red/30'
                  }`}
                >
                  {ACTIVITY_LABEL[a]}
                </button>
              )
            })}
            {/* Population lives in the same row as the activity tabs —
                it's just one more thing this card can show, not a
                fundamentally different section. */}
            <button
              type="button"
              onClick={() => setActiveTab('population')}
              className={`pill border transition-colors inline-flex items-center gap-1.5 ${
                activeTab === 'population'
                  ? 'bg-brand-red text-white border-brand-red'
                  : 'bg-white dark:bg-dark-card text-ink/60 dark:text-dark-muted border-line dark:border-dark-border hover:border-brand-red/40'
              }`}
            >
              <Users className="w-3.5 h-3.5" /> Population
            </button>
          </div>

          {activeTab === 'population' ? (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wide text-ink/60 dark:text-dark-muted mb-3">
                Population comparison — this subject's current standing
              </h4>
              <PopulationPanel subjectId={subjectId} />
            </div>
          ) : activeSession ? (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wide text-ink/60 dark:text-dark-muted mb-3">
                {ACTIVITY_LABEL[activeTab]} — this recording session only
              </h4>
              <TimeSeriesPanel subjectId={subjectId} activity={activeTab} sessionId={activeSession.session_id} />
            </div>
          ) : (
            <p className="text-sm text-ink/60 dark:text-dark-muted">
              No {ACTIVITY_LABEL[activeTab]?.toLowerCase()} recording in this session — this batch was only uploaded with
              {' '}{presentActivities.map((p) => ACTIVITY_LABEL[p]).join(', ') || 'no activities'}.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
