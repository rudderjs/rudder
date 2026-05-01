// Override the id-derived URL (`/demos/pennant-beta`) so SPA nav matches the
// controller route, which is `/demos/pennant/beta` (a sub-path under pennant).
export const route = '/demos/pennant/beta'

export default function PennantBeta() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-8">
      <div className="text-center max-w-lg">
        <h1 className="text-3xl font-bold tracking-tight">Beta dashboard</h1>
        <p className="mt-2 text-muted-foreground text-sm">
          You only see this page if <code>beta-dashboard</code> is active for your scope.
          The route is wrapped in <code>FeatureMiddleware(&apos;beta-dashboard&apos;)</code>;
          unauthorized scopes get a 403 before this view ever renders.
        </p>
      </div>
      <a href="/demos/pennant" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
        ← Back to /demos/pennant
      </a>
    </div>
  )
}
