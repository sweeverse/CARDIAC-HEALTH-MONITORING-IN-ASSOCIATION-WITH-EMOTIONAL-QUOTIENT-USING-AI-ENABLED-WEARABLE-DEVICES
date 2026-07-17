import { describe, it, expect, beforeAll } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'
import App from '../App.jsx'
import { AuthProvider } from '../context/AuthContext.jsx'
import { ThemeProvider } from '../context/ThemeContext.jsx'
import { ToastProvider } from '../context/ToastContext.jsx'
import ErrorBoundary from '../components/ErrorBoundary.jsx'

const ADMIN_CREDS = { email: 'admin@cardioeq.ai', password: 'CardioEQ-Admin-2026!' }

async function loginAs(email, password) {
  const r = await fetch('http://127.0.0.1:8124/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const data = await r.json()
  localStorage.setItem('cardioeq_token', data.access_token)
}

function assertAlive() {
  const crashed = screen.queryByText(/Something went wrong/i)
  if (crashed) throw new Error('App crashed navigating to /app/research (ErrorBoundary triggered)')
}

function renderFullApp(initialPath) {
  return render(
    <React.StrictMode>
      <ErrorBoundary>
        <MemoryRouter initialEntries={[initialPath]}>
          <ThemeProvider>
            <ToastProvider>
              <AuthProvider>
                <App />
              </AuthProvider>
            </ToastProvider>
          </ThemeProvider>
        </MemoryRouter>
      </ErrorBoundary>
    </React.StrictMode>
  )
}

describe('Full app - navigate to EQ Research as admin', () => {
  beforeAll(async () => { await loginAs(ADMIN_CREDS.email, ADMIN_CREDS.password) })

  it('loads /app/research with full layout without crashing', async () => {
    renderFullApp('/app/research')
    await waitFor(() => expect(screen.queryAllByText(/EQ Research/i).length).toBeGreaterThan(0), { timeout: 5000 })
    await new Promise((res) => setTimeout(res, 2000))
    assertAlive()

    // exercise tabs
    for (const label of [/Correlation matrix/i, /^Conclusion$/i, /^Graphs$/i]) {
      const tab = screen.queryByText(label)
      if (tab) {
        fireEvent.click(tab)
        await new Promise((res) => setTimeout(res, 600))
        assertAlive()
      }
    }
  }, 30000)
})

describe('Full app - navigate to EQ Research as a subject (non-admin)', () => {
  it('loads for a subject user without crashing', async () => {
    // sign up a fresh subject user (has EQ score + session data seeded server-side under S01..S12,
    // but a brand NEW signup won't collide since next_available_subject_id continues past S17)
    const email = `subjuser_${Date.now()}@test.com`
    const r = await fetch('http://127.0.0.1:8124/api/auth/signup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: 'Test Subject', email, password: 'password123' }),
    })
    const data = await r.json()
    localStorage.setItem('cardioeq_token', data.access_token)

    renderFullApp('/app/research')
    await waitFor(() => expect(screen.queryAllByText(/EQ Research/i).length).toBeGreaterThan(0), { timeout: 5000 })
    await new Promise((res) => setTimeout(res, 2000))
    assertAlive()
    for (const label of [/Correlation matrix/i, /^Conclusion$/i, /^Graphs$/i]) {
      const tab = screen.queryByText(label)
      if (tab) {
        fireEvent.click(tab)
        await new Promise((res) => setTimeout(res, 600))
        assertAlive()
      }
    }
  }, 30000)
})
