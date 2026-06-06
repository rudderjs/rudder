import '@/index.css'
import { SiteHeader } from 'App/Components/SiteHeader.js'

// Exported Props — picked up by @rudderjs/vite's scanner, which emits
// `pages/__view/registry.d.ts` mapping `'demos.typed-view'` to this shape.
// The controller call in routes/web.ts then type-checks against it.
export interface Props {
  user:  { id: number; name: string }
  posts: ReadonlyArray<{ id: number; title: string }>
}

export default function TypedViewDemo({ user, posts }: Props) {
  return (
    <div className="page">
      <SiteHeader />

      <section className="hero">
        <h1 className="hero-title">Typed view props</h1>
        <p className="hero-lead">
          This view exports an <code className="inline-code">interface Props</code>,
          so the <code className="inline-code">view(&apos;demos.typed-view&apos;, ...)</code> call
          in <code className="inline-code">routes/web.ts</code> type-checks against
          this shape. Pass the wrong props and tsc fails at the controller.
        </p>
      </section>

      <section className="feature-section" style={{ maxWidth: '36rem', margin: '0 auto' }}>
        <div className="form-card">
          <h3 className="feature-title">Hello, {user.name}</h3>
          <p className="feature-desc">user.id: {user.id}</p>
          <ul style={{ margin: '0.75rem 0 0', paddingLeft: '1.25rem' }}>
            {posts.map(p => <li key={p.id}>{p.title}</li>)}
          </ul>
        </div>
      </section>
    </div>
  )
}
