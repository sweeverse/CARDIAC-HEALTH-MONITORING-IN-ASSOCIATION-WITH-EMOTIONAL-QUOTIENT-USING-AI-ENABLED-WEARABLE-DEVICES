import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { LayoutGrid, Settings, UserCircle, Upload, GitBranch, ShieldCheck, Users, ChevronsLeft, ChevronsRight } from 'lucide-react'
import Logo from './Logo.jsx'
import { useAuth } from '../context/AuthContext.jsx'

const linkClasses = ({ isActive }) =>
  `group flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
    isActive
      ? 'bg-brand-red text-white shadow-card translate-x-0.5'
      : 'text-ink/65 dark:text-dark-muted hover:bg-red-50 dark:hover:bg-dark-card hover:text-brand-red hover:translate-x-0.5'
  }`

const iconClasses = 'w-4 h-4 shrink-0 transition-transform duration-200 group-hover:scale-110'

// Persisted across sessions so re-opening the app on desktop remembers
// whether the sidebar was collapsed to icon-only mode.
const COLLAPSE_KEY = 'cardioeq_sidebar_collapsed'

export default function Sidebar({ open, onClose }) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1')

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  const NavItem = ({ to, end, icon: Icon, children }) => (
    <NavLink to={to} end={end} className={linkClasses} title={collapsed ? children : undefined}>
      <Icon className={iconClasses} />
      {!collapsed && <span className="truncate">{children}</span>}
    </NavLink>
  )

  return (
    <>
      {open && <div className="fixed inset-0 bg-ink/30 backdrop-blur-[2px] z-30 lg:hidden animate-[fadeIn_.15s_ease]" onClick={onClose} />}
      <aside className={`fixed lg:sticky lg:top-0 z-40 top-0 left-0 h-full lg:h-screen ${collapsed ? 'lg:w-20' : 'lg:w-64'} w-64 bg-surface dark:bg-dark-surface border-r border-line/70 dark:border-dark-border flex flex-col shrink-0
        transition-[transform,width] duration-300 ease-out ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        {/* Collapse/expand toggle — pinned to the sidebar's outer edge,
            vertically centered, and fixed there regardless of scroll or
            collapsed state (desktop only; mobile always shows the full
            sidebar as an overlay). Lives outside the nav/footer flow so it
            never drifts with content. */}
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="hidden lg:flex absolute top-1/2 -right-3.5 -translate-y-1/2 z-10 items-center justify-center w-7 h-7 rounded-full
            bg-surface dark:bg-dark-card border border-line/70 dark:border-dark-border shadow-card
            text-ink/70 dark:text-dark-muted hover:text-brand-red dark:hover:text-red-400 hover:border-brand-red/40 dark:hover:border-red-900/50
            transition-colors"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronsRight className="w-3.5 h-3.5" /> : <ChevronsLeft className="w-3.5 h-3.5" />}
        </button>

        <div className={`px-5 py-5 border-b border-line/70 dark:border-dark-border flex items-center ${collapsed ? 'lg:justify-center lg:px-3' : 'justify-between'}`}>
          {collapsed ? (
            <span className="hidden lg:block">
              <Logo size="sm" showText={false} />
            </span>
          ) : (
            <Logo size="sm" />
          )}
          <div className="lg:hidden">
            {!collapsed && null}
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto overflow-x-hidden">
          {!collapsed && <p className="px-3 text-[11px] font-semibold uppercase tracking-wide text-ink/65 dark:text-dark-muted mb-2">Workspace</p>}
          <NavItem to="/app" end icon={LayoutGrid}>Cohort overview</NavItem>
          <NavItem to="/app/upload" icon={Upload}>Upload recording</NavItem>
          <NavItem to="/app/research" icon={GitBranch}>EQ Research</NavItem>

          {isAdmin && (
            <>
              {!collapsed && <p className="px-3 text-[11px] font-semibold uppercase tracking-wide text-ink/65 dark:text-dark-muted mt-6 mb-2">Admin</p>}
              <NavItem to="/app/admin/users" icon={Users}>Admin User Management</NavItem>
              <NavItem to="/app/admin/eq-management" icon={ShieldCheck}>Admin EQ Management</NavItem>
            </>
          )}

          {!collapsed && <p className="px-3 text-[11px] font-semibold uppercase tracking-wide text-ink/65 dark:text-dark-muted mt-6 mb-2">Account</p>}
          <NavItem to="/app/profile" icon={UserCircle}>Profile</NavItem>
          <NavItem to="/app/settings" icon={Settings}>Settings</NavItem>
        </nav>

        <div className={`px-5 py-4 border-t border-line/70 dark:border-dark-border ${collapsed ? 'lg:hidden' : ''}`}>
          <p className="text-[11px] text-ink/65 dark:text-dark-muted leading-relaxed">
            Research-grade analytics. Not a diagnostic medical device.
          </p>
        </div>
      </aside>
    </>
  )
}
