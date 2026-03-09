import '@/index.css'
import { usePageContext } from 'vike-react/usePageContext'

export default function Page() {
  const { is404, abortReason, abortStatusCode } = usePageContext() as {
    is404: boolean
    abortStatusCode?: number
    abortReason?: string
  }

  if (is404) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-2">
        <h1 className="text-2xl font-bold">404 — Page Not Found</h1>
        <p className="text-muted-foreground">This page could not be found.</p>
        <a href="/" className="mt-4 text-sm underline">Go home</a>
      </div>
    )
  }

  if (abortStatusCode === 401) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-2">
        <h1 className="text-2xl font-bold">401 — Unauthorized</h1>
        <p className="text-muted-foreground">{abortReason ?? 'You must be logged in to view this page.'}</p>
        <a href="/" className="mt-4 text-sm underline">Go home</a>
      </div>
    )
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-2">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="text-muted-foreground">{abortReason ?? 'An unexpected error occurred.'}</p>
      <a href="/" className="mt-4 text-sm underline">Go home</a>
    </div>
  )
}
