import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2, AlertCircle } from 'lucide-react'
import AuthLayout from '../components/AuthLayout.jsx'
import { useAuth } from '../context/AuthContext.jsx'

export default function SignIn() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const onSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(form.email, form.password)
      navigate('/app')
    } catch (err) {
      setError(err.response?.data?.detail || 'Incorrect email or password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to your CardioEQ AI workspace."
      footer={<>Don't have an account? <Link to="/sign-up" className="text-brand-red font-semibold">Create one</Link></>}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="label-field">Email</label>
          <input type="email" className="input-field" required value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@hospital.org" />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="label-field !mb-0">Password</label>
            <Link to="/forgot-password" className="text-xs font-semibold text-brand-red">Forgot password?</Link>
          </div>
          <input type="password" className="input-field" required value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="••••••••" />
        </div>
        {error && (
          <div className="flex items-start gap-2 text-sm text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2.5">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
          </div>
        )}
        <button type="submit" disabled={loading} className="btn-primary w-full py-2.5">
          {loading && <Loader2 className="w-4 h-4 animate-spin" />} Sign in
        </button>
      </form>
    </AuthLayout>
  )
}
