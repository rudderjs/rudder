import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface PennantProps {
  user:   { id: string; name: string; email: string } | null
  values: Record<string, unknown>
}

interface FeatureCardSpec {
  name:        string
  shape:       string
  resolver:    string
  expected:    string
}

const features: FeatureCardSpec[] = [
  {
    name:     'dark-mode',
    shape:    'boolean',
    resolver: '() => true',
    expected: 'Always true.',
  },
  {
    name:     'max-uploads',
    shape:    'value',
    resolver: '() => 10',
    expected: 'Returns the literal value, not a boolean.',
  },
  {
    name:     'beta-dashboard',
    shape:    'scoped',
    resolver: '(scope) => scope !== null',
    expected: 'True for any signed-in user; false for anon.',
  },
  {
    name:     'new-checkout',
    shape:    'lottery',
    resolver: '() => Lottery.odds(1, 4)',
    expected: '~25% chance per scope. Stable on subsequent checks (memo’d).',
  },
]

export default function PennantDemo({ user, values }: PennantProps) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-start gap-8 p-8 max-w-4xl mx-auto">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">Feature flags</h1>
        <p className="mt-2 text-muted-foreground text-sm max-w-2xl">
          Resolved against the current scope ({user
            ? <><strong>{user.name}</strong> · {user.email}</>
            : <em>guest</em>}). Definitions live in{' '}
          <code className="text-xs bg-muted px-1 py-0.5 rounded">app/Providers/AppServiceProvider.ts</code>{' '}
          and resolution happens here via{' '}
          <code className="text-xs bg-muted px-1 py-0.5 rounded">Feature.values([...], scope)</code>.
        </p>
        {!user && (
          <p className="mt-3 text-xs text-muted-foreground">
            Sign in to see <code>beta-dashboard</code> flip to true.
          </p>
        )}
      </div>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 w-full">
        {features.map(f => {
          const resolved = values[f.name]
          const display  = JSON.stringify(resolved)
          return (
            <Card key={f.name}>
              <CardHeader>
                <CardTitle className="font-mono text-base">{f.name}</CardTitle>
                <CardDescription className="text-xs uppercase tracking-wide">{f.shape}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">resolver</div>
                  <code className="text-xs bg-muted px-2 py-1 rounded block">{f.resolver}</code>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">expected</div>
                  <p className="text-xs">{f.expected}</p>
                </div>
                <div className="border-t pt-2 mt-1">
                  <div className="text-xs text-muted-foreground">resolved value</div>
                  <code className="font-mono text-base">{display}</code>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card className="w-full">
        <CardHeader>
          <CardTitle>FeatureMiddleware</CardTitle>
          <CardDescription>
            <code>/demos/pennant/beta</code> is wrapped in{' '}
            <code>FeatureMiddleware(&apos;beta-dashboard&apos;)</code>. The middleware reads{' '}
            <code>req.user</code> as the scope; non-matching scopes get a 403.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <a href="/demos/pennant/beta">
            <Button>Open /demos/pennant/beta →</Button>
          </a>
        </CardContent>
      </Card>

      <a href="/demos" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
        ← Back to demos
      </a>
    </div>
  )
}
