import { useMutation } from '@tanstack/react-query'
import { NavLink, Outlet } from 'react-router'
import { api, ApiError, useMe } from '../api.ts'
import { SignInPage } from '../pages/SignInPage.tsx'
import { ErrorMessage } from './ErrorMessage.tsx'

export function Layout() {
  const me = useMe()
  const signOut = useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    // A full reload drops every cached query along with the session.
    onSuccess: () => window.location.assign('/'),
  })

  if (me.isPending) {
    return (
      <main className="page">
        <p className="muted">Loading…</p>
      </main>
    )
  }
  if (me.error instanceof ApiError && me.error.status === 401) return <SignInPage />
  if (me.isError) {
    return (
      <main className="page">
        <ErrorMessage error={me.error} />
      </main>
    )
  }

  return (
    <>
      <header className="topbar">
        <span className="brand">Train Smarter</span>
        <nav className="nav">
          <NavLink to="/connections">Connections</NavLink>
        </nav>
        <div className="account">
          <span className="muted">{me.data.user.email}</span>
          <button type="button" className="button subtle" onClick={() => signOut.mutate()}>
            Sign out
          </button>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </>
  )
}
