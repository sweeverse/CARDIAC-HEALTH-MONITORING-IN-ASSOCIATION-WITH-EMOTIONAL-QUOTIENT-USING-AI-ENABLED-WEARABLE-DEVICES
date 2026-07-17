import { Component } from 'react'
import { AlertTriangle } from 'lucide-react'

// Catches any render-time exception anywhere below it. Without this, a
// single unhandled error (e.g. a bad import, a null deref) unmounts the
// entire tree and leaves a totally blank page with no clue why — which is
// exactly what happened to non-admin users when SubjectsOverview.jsx
// called formatScore() without importing it. This won't silently hide
// bugs (the error is still logged to the console), it just keeps the app
// visibly alive so the person isn't staring at a blank screen.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('CardioEQ AI — uncaught render error:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-paper dark:bg-dark-bg px-6">
          <div className="max-w-md text-center">
            <AlertTriangle className="w-8 h-8 text-brand-red mx-auto mb-3" />
            <h1 className="font-display font-semibold text-xl text-ink dark:text-dark-text mb-2">Something went wrong</h1>
            <p className="text-sm text-ink/60 dark:text-dark-muted mb-5">
              This page hit an unexpected error. Try reloading — if it keeps happening, please report it.
            </p>
            <button onClick={() => window.location.reload()} className="btn-primary">
              Reload page
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
