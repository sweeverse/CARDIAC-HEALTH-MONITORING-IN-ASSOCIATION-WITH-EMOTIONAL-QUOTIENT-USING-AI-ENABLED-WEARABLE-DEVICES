import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import AuthLayout from '../components/AuthLayout.jsx'
import { Endpoints } from '../lib/api.js'

export default function ForgotPassword() {
  const [stage, setStage] = useState('request') // request -> reset
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const requestReset = async (e) => {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const res = await Endpoints.forgotPassword({ email })
      setMessage(res.data.message)
      if (res.data.dev_only_reset_token) {
        setToken(res.data.dev_only_reset_token) // dev convenience only — real deployments email this
      }
      setStage('reset')
    } catch (err) {
      setError(err.response?.data?.detail || 'Something went wrong.')
    } finally { setLoading(false) }
  }

  const submitReset = async (e) => {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      await Endpoints.resetPassword({ token, new_password: newPassword })
      setMessage('Password updated. You can now sign in.')
      setStage('done')
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not reset password.')
    } finally { setLoading(false) }
  }

  return (
    <AuthLayout
      title={stage === 'request' ? 'Reset your password' : stage === 'reset' ? 'Set a new password' : 'All set'}
      subtitle={stage === 'request' ? "We'll help you regain access to your account." : undefined}
      footer={<>Remembered it? <Link to="/sign-in" className="text-brand-red font-semibold">Back to sign in</Link></>}
    >
      {stage === 'request' && (
        <form onSubmit={requestReset} className="space-y-4">
          <div>
            <label className="label-field">Email</label>
            <input type="email" className="input-field" required value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="you@hospital.org" />
          </div>
          {error && <ErrorBox text={error} />}
          <button type="submit" disabled={loading} className="btn-primary w-full py-2.5">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} Send reset instructions
          </button>
        </form>
      )}

      {stage === 'reset' && (
        <form onSubmit={submitReset} className="space-y-4">
          {message && (
            <div className="flex items-start gap-2 text-sm text-brand-red bg-red-50 border border-brand-red/20 rounded-lg px-3 py-2.5">
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> {message}
            </div>
          )}
          <div>
            <label className="label-field">Reset token</label>
            <input className="input-field font-mono text-xs" required value={token}
              onChange={(e) => setToken(e.target.value)} placeholder="Paste the token from your email" />
            <p className="text-xs text-ink/70 mt-1.5">
              In this dev build the token is returned directly in the API response since no email
              service is wired up yet — see backend/app/routers/auth.py.
            </p>
          </div>
          <div>
            <label className="label-field">New password</label>
            <input type="password" className="input-field" required value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 8 characters" />
          </div>
          {error && <ErrorBox text={error} />}
          <button type="submit" disabled={loading} className="btn-primary w-full py-2.5">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} Update password
          </button>
        </form>
      )}

      {stage === 'done' && (
        <div className="flex items-start gap-2 text-sm text-brand-red bg-red-50 border border-brand-red/20 rounded-lg px-3 py-2.5">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> {message}
        </div>
      )}
    </AuthLayout>
  )
}

function ErrorBox({ text }) {
  return (
    <div className="flex items-start gap-2 text-sm text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2.5">
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {text}
    </div>
  )
}
