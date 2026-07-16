import { Routes, Route } from 'react-router-dom'
import Landing from './pages/Landing.jsx'
import SignUp from './pages/SignUp.jsx'
import SignIn from './pages/SignIn.jsx'
import ForgotPassword from './pages/ForgotPassword.jsx'
import DashboardLayout from './components/DashboardLayout.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import AdminRoute from './components/AdminRoute.jsx'
import SubjectsOverview from './pages/SubjectsOverview.jsx'
import SubjectDashboard from './pages/SubjectDashboard.jsx'
import UploadRecording from './pages/UploadRecording.jsx'
import Profile from './pages/Profile.jsx'
import Settings from './pages/Settings.jsx'
import Research from './pages/Research.jsx'
import AdminEqManagement from './pages/AdminEqManagement.jsx'
import AdminUserManagement from './pages/AdminUserManagement.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/sign-up" element={<SignUp />} />
      <Route path="/sign-in" element={<SignIn />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />

      <Route
        path="/app"
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<SubjectsOverview />} handle={{ title: 'Cohort overview' }} />
        <Route path="upload" element={<UploadRecording />} handle={{ title: 'Upload recording' }} />
        <Route path="subjects/:subjectId" element={<SubjectDashboard />} handle={{ title: 'Subject dashboard' }} />
        <Route path="research" element={<Research />} handle={{ title: 'EQ Research' }} />
        <Route
          path="admin/eq-management"
          element={<AdminRoute><AdminEqManagement /></AdminRoute>}
          handle={{ title: 'Admin EQ Management' }}
        />
        <Route
          path="admin/users"
          element={<AdminRoute><AdminUserManagement /></AdminRoute>}
          handle={{ title: 'Admin User Management' }}
        />
        <Route path="profile" element={<Profile />} handle={{ title: 'Profile' }} />
        <Route path="settings" element={<Settings />} handle={{ title: 'Settings' }} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-paper text-center px-6">
      <div>
        <p className="font-display text-6xl font-semibold text-brand-red">404</p>
        <p className="text-ink/80 mt-2">This page doesn't exist.</p>
        <a href="/" className="btn-primary mt-6 inline-flex">Back home</a>
      </div>
    </div>
  )
}
