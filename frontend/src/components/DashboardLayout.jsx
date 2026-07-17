import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar.jsx'
import Topbar from './Topbar.jsx'
import AssistantWidget from './AssistantWidget.jsx'

const TITLES = [
  { test: (p) => p === '/app' || p === '/app/', title: 'Cohort overview' },
  { test: (p) => p.startsWith('/app/upload'), title: 'Upload recording' },
  { test: (p) => p.startsWith('/app/subjects/'), title: 'Subject dashboard' },
  { test: (p) => p.startsWith('/app/profile'), title: 'Profile' },
  { test: (p) => p.startsWith('/app/settings'), title: 'Settings' },
  { test: (p) => p.startsWith('/app/research'), title: 'EQ Research' },
]

export default function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()
  const title = TITLES.find((t) => t.test(location.pathname))?.title || 'Dashboard'

  return (
    <div className="min-h-screen flex bg-paper dark:bg-dark-bg">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar onMenuClick={() => setSidebarOpen(true)} title={title} />
        <main className="flex-1 p-4 sm:p-6 max-w-[1400px] w-full mx-auto">
          <Outlet />
        </main>
        <footer className="border-t border-line/70 dark:border-dark-border px-6 py-4 text-xs text-ink/65 dark:text-dark-muted flex items-center justify-end">
          <span className="font-mono">v1.0.0</span>
        </footer>
      </div>
      <AssistantWidget />
    </div>
  )
}
