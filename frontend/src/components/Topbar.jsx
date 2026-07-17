import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Menu, ChevronDown, LogOut, UserCircle, Settings, Sun, Moon } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { useTheme } from '../context/ThemeContext.jsx'
import Logo from './Logo.jsx'

// Notifications page/dropdown removed entirely (spec A.5) — important
// events now surface as toasts (see context/ToastContext.jsx) instead.
export default function Topbar({ onMenuClick, title }) {
  const { user, logout } = useAuth()
  const { dark, toggle } = useTheme()
  const navigate = useNavigate()
  const [profileOpen, setProfileOpen] = useState(false)

  return (
    <header className="h-16 border-b border-line/70 dark:border-dark-border bg-surface/90 dark:bg-dark-surface/95 backdrop-blur flex items-center justify-between px-4 sm:px-6 sticky top-0 z-20">
      <div className="flex items-center gap-3">
        <button className="lg:hidden p-2 -ml-2 text-ink/60 dark:text-dark-muted rounded-lg hover:bg-red-50 dark:hover:bg-dark-card transition-colors" onClick={onMenuClick}>
          <Menu className="w-5 h-5" />
        </button>
        <span className="lg:hidden">
          <Logo size="sm" />
        </span>
        <h1 key={title} className="hidden lg:block font-display font-semibold text-lg text-ink dark:text-dark-text animate-[fadeSlideIn_.25s_ease]">{title}</h1>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={toggle}
          className="relative p-2 rounded-full hover:bg-red-50 dark:hover:bg-dark-card text-ink/60 dark:text-dark-muted hover:text-brand-red dark:hover:text-red-400 transition-all duration-300 hover:rotate-12"
          title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {dark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>

        <div className="relative">
          <button
            className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full hover:bg-red-50 dark:hover:bg-dark-card transition-colors"
            onClick={() => setProfileOpen((v) => !v)}
          >
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-red to-red-800 text-white flex items-center justify-center text-sm font-semibold font-display shadow-card">
              {(user?.full_name || 'U')[0]}
            </div>
            <span className="hidden sm:block text-sm font-medium text-ink/80 dark:text-dark-text max-w-[120px] truncate">{user?.full_name}</span>
            <ChevronDown className={`w-4 h-4 text-ink/65 dark:text-dark-muted transition-transform duration-200 ${profileOpen ? 'rotate-180' : ''}`} />
          </button>
          {profileOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setProfileOpen(false)} />
              <div className="absolute right-0 mt-2 w-52 card p-1.5 z-30 origin-top-right animate-[fadeSlideIn_.15s_ease]">
                <Link to="/app/profile" className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-red-50 dark:hover:bg-dark-surface text-ink/75 dark:text-dark-text transition-colors" onClick={() => setProfileOpen(false)}>
                  <UserCircle className="w-4 h-4" /> Profile
                </Link>
                <Link to="/app/settings" className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-red-50 dark:hover:bg-dark-surface text-ink/75 dark:text-dark-text transition-colors" onClick={() => setProfileOpen(false)}>
                  <Settings className="w-4 h-4" /> Settings
                </Link>
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-danger/10 text-danger dark:text-red-400 transition-colors"
                  onClick={() => { logout(); navigate('/') }}
                >
                  <LogOut className="w-4 h-4" /> Log out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
