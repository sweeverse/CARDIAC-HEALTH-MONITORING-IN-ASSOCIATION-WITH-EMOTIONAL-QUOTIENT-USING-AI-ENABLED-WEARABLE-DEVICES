import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

// Nested inside ProtectedRoute, so `user` is already guaranteed to exist —
// this only adds the role check for pages exclusive to the administrator
// account (e.g. Admin EQ Management). Non-admins are bounced back to the
// cohort overview rather than shown a dead end.
export default function AdminRoute({ children }) {
  const { user } = useAuth()
  if (user?.role !== 'admin') return <Navigate to="/app" replace />
  return children
}
