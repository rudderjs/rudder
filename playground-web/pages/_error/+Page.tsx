import { usePageContext } from 'vike-react/usePageContext'

const errors: Record<number | 'default', { title: string; message: string }> = {
  404: {
    title:   'Page not found',
    message: 'The page you are looking for does not exist or has been moved.',
  },
  401: {
    title:   'Unauthorized',
    message: 'You must be signed in to view this page.',
  },
  403: {
    title:   'Forbidden',
    message: 'You do not have permission to access this page.',
  },
  500: {
    title:   'Server error',
    message: 'Something went wrong on our end. Please try again later.',
  },
  default: {
    title:   'Something went wrong',
    message: 'An unexpected error occurred. Please try again.',
  },
}

// Self-contained styling so this page works in any playground/scaffold,
// even when no shadcn UI components are installed. Visually matches the
// outline + default Button variants from `@/components/ui/button`.
const buttonBase    = 'inline-flex items-center justify-center h-8 px-2.5 rounded-lg text-sm font-medium transition-colors'
const buttonOutline = `${buttonBase} border border-border bg-background text-foreground hover:bg-muted`
const buttonPrimary = `${buttonBase} bg-primary text-primary-foreground hover:bg-primary/80`

export default function ErrorPage() {
  const { is404, abortStatusCode, abortReason } = usePageContext() as {
    is404?: boolean
    abortStatusCode?: number
    abortReason?: string
  }

  const code   = is404 ? 404 : (abortStatusCode ?? 500)
  const info   = errors[code] ?? errors['default']
  const title   = abortReason ?? info.title
  const message = info.message

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-6 text-center">

      <p className="text-8xl font-black tracking-tighter text-muted-foreground/20 select-none">
        {code}
      </p>

      <div className="flex flex-col gap-2 max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground text-sm">{message}</p>
      </div>

      <div className="flex gap-3">
        <button type="button" className={buttonOutline} onClick={() => window.history.back()}>
          Go back
        </button>
        <a href="/" className={buttonPrimary}>Go home</a>
      </div>

    </div>
  )
}
