import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react'

const ToastContext = createContext(null)

// Visual language per toast type — kept deliberately restrained (white/
// surface card, colored accent bar + icon only) rather than a colored
// background, per the "premium, not loud" toast redesign. Each entry
// carries its own light+dark class pairing so nothing needs to be
// recomputed per-render.
const TOAST_STYLES = {
  success: {
    Icon: CheckCircle2,
    accent: 'text-success dark:text-green-400',
    bar: 'bg-success dark:bg-green-500',
    ring: 'bg-success/10 dark:bg-green-400/10',
  },
  error: {
    Icon: AlertCircle,
    accent: 'text-danger dark:text-red-400',
    bar: 'bg-danger dark:bg-red-500',
    ring: 'bg-danger/10 dark:bg-red-400/10',
  },
  warning: {
    Icon: AlertTriangle,
    accent: 'text-brand-orange dark:text-orange-400',
    bar: 'bg-brand-orange dark:bg-orange-500',
    ring: 'bg-brand-orange/10 dark:bg-orange-400/10',
  },
  info: {
    Icon: Info,
    accent: 'text-teal-600 dark:text-teal-300',
    bar: 'bg-teal-600 dark:bg-teal-400',
    ring: 'bg-teal-600/10 dark:bg-teal-400/10',
  },
}

const AUTO_DISMISS_MS = 4000
const EXIT_ANIMATION_MS = 320

// Replaces the old Notifications bell/dropdown entirely (spec A.5): every
// important system event now surfaces as a short-lived toast instead of
// living in a persistent notifications page.
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const idRef = useRef(0)
  // Tracks each toast's auto-dismiss timer so a manual close (the X
  // button) can cancel it — without this, closing a toast early still
  // let its original timer fire a second, harmless-but-confusing removal
  // later, which was part of why dismissal felt inconsistent.
  const timersRef = useRef({})

  const clearTimer = useCallback((id) => {
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id])
      delete timersRef.current[id]
    }
  }, [])

  // Two-step removal: first flag the toast as "leaving" so it plays its
  // exit animation, then actually drop it from state once that animation
  // has had time to finish. Filtering it out of state immediately made it
  // just vanish with no exit motion.
  const dismiss = useCallback((id) => {
    clearTimer(id)
    setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x)))
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id))
    }, EXIT_ANIMATION_MS)
  }, [clearTimer])

  const push = useCallback((message, type = 'success', duration = AUTO_DISMISS_MS) => {
    const id = ++idRef.current
    setToasts((t) => [...t, { id, message, type, leaving: false }])
    if (duration) timersRef.current[id] = setTimeout(() => dismiss(id), duration)
    return id
  }, [dismiss])

  const toast = {
    success: (msg) => push(msg, 'success'),
    error: (msg) => push(msg, 'error'),
    warning: (msg) => push(msg, 'warning'),
    info: (msg) => push(msg, 'info'),
  }

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2.5 w-[min(360px,calc(100vw-2rem))] pointer-events-none">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({ toast, onDismiss }) {
  const { Icon, accent, bar, ring } = TOAST_STYLES[toast.type] || TOAST_STYLES.success

  return (
    <div
      className={`relative flex items-start gap-3 rounded-xl border border-line/60 dark:border-dark-border
        bg-white dark:bg-dark-card shadow-pop dark:shadow-dark-card pl-3.5 pr-3 py-3 text-sm overflow-hidden
        pointer-events-auto ${toast.leaving ? 'animate-toastOut' : 'animate-toastIn'}`}
      role="status"
    >
      <span className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-xl ${bar}`} />
      <span className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${ring}`}>
        <Icon className={`w-3.5 h-3.5 ${accent}`} />
      </span>
      <p className="flex-1 text-ink/85 dark:text-dark-text leading-snug pt-0.5">{toast.message}</p>
      <button
        onClick={onDismiss}
        className="text-ink/40 hover:text-ink/70 dark:text-dark-muted dark:hover:text-dark-text shrink-0 mt-0.5 transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

export const useToast = () => useContext(ToastContext)
