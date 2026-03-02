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
      <>
        <h1 style={{ fontWeight: 'bold' }}>404 — Page Not Found</h1>
        <p>This page could not be found.</p>
      </>
    )
  }

  if (abortStatusCode === 401) {
    return (
      <>
        <h1>401 — Unauthorized</h1>
        <p>{abortReason ?? 'You must be logged in to view this page.'}</p>
      </>
    )
  }

  if (abortStatusCode === 403) {
    return (
      <>
        <h1>403 — Forbidden</h1>
        <p>{abortReason ?? 'You do not have permission to view this page.'}</p>
      </>
    )
  }

  return (
    <>
      <h1>Something went wrong</h1>
      <p>{abortReason ?? 'An unexpected error occurred.'}</p>
    </>
  )
}
