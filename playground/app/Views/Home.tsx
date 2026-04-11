interface HomeProps {
  appName:    string
  greeting:   string
  features:   string[]
}

export default function Home({ appName, greeting, features }: HomeProps) {
  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="mb-2 text-4xl font-bold tracking-tight">{appName}</h1>
      <p className="mb-6 text-lg text-muted-foreground">{greeting}</p>

      <div className="mb-6 rounded-md border bg-muted/30 p-4 text-sm">
        Rendered from <code>app/Views/Home.tsx</code> via{' '}
        <code>view('home', &#123; ... &#125;)</code> in a router handler.
      </div>

      <h2 className="mb-3 text-xl font-semibold">Features</h2>
      <ul className="space-y-2">
        {features.map(f => (
          <li key={f} className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-primary" />
            {f}
          </li>
        ))}
      </ul>

      <div className="mt-8 flex gap-4">
        <a href="/about" className="text-sm font-medium underline">Go to About →</a>
      </div>
    </div>
  )
}
