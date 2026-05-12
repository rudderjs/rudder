import { usePageContext } from 'vike-react/usePageContext'
import { getCsrfToken } from '@rudderjs/middleware/client'

interface PageContextUser {
  user?: { name?: string; email?: string } | null
}

export function SiteHeader() {
  const ctx  = usePageContext() as unknown as PageContextUser
  const user = ctx.user ?? null

  async function handleSignOut() {
    await fetch('/auth/sign-out', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'X-CSRF-Token':  getCsrfToken(),
      },
      body: '{}',
    })
    window.location.href = '/'
  }

  return (
    <header className="page-header">
      <nav className="page-nav">
        <a href="/" className="brand">
          <span className="brand-dot" />
          Rudder
        </a>
        <div className="nav-right">
          <a href="/demos" className="nav-link">Demos</a>
          {user ? (
            <>
              <span className="nav-badge">
                <strong>{user.name ?? user.email ?? 'Account'}</strong>
              </span>
              <button type="button" onClick={handleSignOut} className="nav-button">
                Sign out
              </button>
            </>
          ) : (
            <>
              <a href="/login" className="nav-link">Login</a>
              <a href="/register" className="nav-button">Register</a>
            </>
          )}
        </div>
      </nav>
    </header>
  )
}
