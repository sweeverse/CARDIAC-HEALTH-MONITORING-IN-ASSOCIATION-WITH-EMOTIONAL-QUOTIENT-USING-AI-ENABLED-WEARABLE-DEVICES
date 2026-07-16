import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2, AlertCircle } from 'lucide-react'
import AuthLayout from '../components/AuthLayout.jsx'
import { useAuth } from '../context/AuthContext.jsx'

export default function SignUp() {
  const { signup } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ full_name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const onSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setLoading(true)
    try {
      await signup(form.full_name, form.email, form.password)
      navigate('/app')
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not create account. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start exploring explainable cardiovascular analytics."
      footer={<>Already have an account? <Link to="/sign-in" className="text-brand-red font-semibold">Sign in</Link></>}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="label-field">Full name</label>
          <input className="input-field" required value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Dr. Asha Verma" />
        </div>
        <div>
          <label className="label-field">Email</label>
          <input type="email" className="input-field" required value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@hospital.org" />
        </div>
        <div>
          <label className="label-field">Password</label>
          <input type="password" className="input-field" required value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 8 characters" />
        </div>
        {error && (
          <div className="flex items-start gap-2 text-sm text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2.5">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
          </div>
        )}
        <button type="submit" disabled={loading} className="btn-primary w-full py-2.5">
          {loading && <Loader2 className="w-4 h-4 animate-spin" />} Create account
        </button>
      </form>
    </AuthLayout>
  )
}
