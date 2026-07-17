import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { Endpoints } from '../lib/api'
import { useToast } from './ToastContext.jsx'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const toast = useToast()

  const refreshUser = useCallback(async () => {
    const token = localStorage.getItem('cardioeq_token')
    if (!token) {
      setUser(null)
      setLoading(false)
      return
    }
    try {
      const res = await Endpoints.me()
      setUser(res.data)
    } catch {
      localStorage.removeItem('cardioeq_token')
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refreshUser() }, [refreshUser])

  const login = async (email, password) => {
    try {
      const res = await Endpoints.login({ email, password })
      localStorage.setItem('cardioeq_token', res.data.access_token)
      setUser(res.data.user)
      toast?.success(`Welcome back, ${res.data.user?.full_name || 'there'}.`)
      return res.data.user
    } catch (err) {
      toast?.error(err.response?.data?.detail || 'Login failed. Check your email and password.')
      throw err
    }
  }

  const signup = async (full_name, email, password) => {
    try {
      const res = await Endpoints.signup({ full_name, email, password })
      localStorage.setItem('cardioeq_token', res.data.access_token)
      setUser(res.data.user)
      toast?.success('Account created — welcome to CardioEQ AI.')
      return res.data.user
    } catch (err) {
      toast?.error(err.response?.data?.detail || 'Sign up failed. Please try again.')
      throw err
    }
  }

  const logout = () => {
    localStorage.removeItem('cardioeq_token')
    setUser(null)
    toast?.info('Logged out.')
  }

  return (
    <AuthContext.Provider value={{ user, setUser, loading, login, signup, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
