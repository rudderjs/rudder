import type { ReactNode } from 'react'

// Server-component layout. vike-react-rsc provides the html/body document shell;
// this just wraps the page content.
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '3rem auto', padding: '0 1rem', lineHeight: 1.6 }}>
      {children}
    </main>
  )
}
