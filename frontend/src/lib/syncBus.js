// Task 16 — Dashboard Synchronization: "whenever backend data changes,
// automatically refresh dashboards/cards/analytics/reports/graphs, no
// manual reload." This app is plain REST (no websocket/SSE server), so
// true server-push isn't available — this bus is the practical
// equivalent: every action that actually changes backend data (upload,
// delete, EQ submit, admin create/delete/retrain) broadcasts a same-tab
// event the moment its request resolves, and every data-displaying page
// listens for it and refetches. Combined with a refetch-on-tab-focus
// listener (also wired below) for the "someone else changed something in
// another tab" case, nothing on screen requires a manual browser reload
// to catch up.

const EVENT_NAME = 'cardioeq:data-changed'

/** Call after any request that changes backend data resolves successfully. */
export function notifyDataChanged(detail) {
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }))
}

/**
 * Subscribe a refetch callback to both same-tab data-change events and
 * tab-focus/visibility regain. Returns an unsubscribe function — call it
 * from a useEffect cleanup.
 */
export function onDataChanged(callback) {
  const handleFocus = () => { if (document.visibilityState === 'visible') callback() }
  window.addEventListener(EVENT_NAME, callback)
  window.addEventListener('focus', callback)
  document.addEventListener('visibilitychange', handleFocus)
  return () => {
    window.removeEventListener(EVENT_NAME, callback)
    window.removeEventListener('focus', callback)
    document.removeEventListener('visibilitychange', handleFocus)
  }
}
