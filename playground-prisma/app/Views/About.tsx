interface AboutProps {
  title:    string
  version:  string
  team:     { name: string; role: string }[]
}

export default function About({ title, version, team }: AboutProps) {
  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="mb-2 text-4xl font-bold tracking-tight">{title}</h1>
      <p className="mb-6 text-sm text-muted-foreground">Version {version}</p>

      <div className="mb-6 rounded-md border bg-muted/30 p-4 text-sm">
        Rendered from <code>app/Views/About.tsx</code> via{' '}
        <code>view('about', &#123; ... &#125;)</code> in a router handler.
      </div>

      <h2 className="mb-3 text-xl font-semibold">Team</h2>
      <ul className="divide-y rounded-md border">
        {team.map(member => (
          <li key={member.name} className="flex items-center justify-between p-3">
            <span className="font-medium">{member.name}</span>
            <span className="text-sm text-muted-foreground">{member.role}</span>
          </li>
        ))}
      </ul>

      <div className="mt-8 flex gap-4">
        <a href="/home" className="text-sm font-medium underline">← Back to Home</a>
      </div>
    </div>
  )
}
