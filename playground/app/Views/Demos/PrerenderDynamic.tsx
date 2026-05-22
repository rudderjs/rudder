import { usePageContext } from 'vike-react/usePageContext'
import '@/index.css'
import { SiteHeader } from 'App/Components/SiteHeader.js'

// Parameterized route — Vike's `@slug` syntax matches one URL segment and
// surfaces the value on `pageContext.routeParams.slug`.
export const route = '/demos/prerender-dynamic/@slug'

// Dynamic prerender (Phase 2): enumerate the URLs to materialize at build
// time. The array form is the easiest entry point; for DB-driven slug lists
// this could be `async () => prisma.post.findMany({ select: { slug: true } })`
// returning `[/demos/prerender-dynamic/${slug}, ...]`.
//
// `pnpm build` writes:
//   dist/client/demos/prerender-dynamic/alpha/index.html
//   dist/client/demos/prerender-dynamic/beta/index.html
export const prerender = [
  '/demos/prerender-dynamic/alpha',
  '/demos/prerender-dynamic/beta',
]

const POSTS: Record<string, { title: string; body: string }> = {
  alpha: { title: 'Alpha post', body: 'The first prerendered article.' },
  beta:  { title: 'Beta post',  body: 'The second prerendered article.' },
}

export default function PrerenderDynamic() {
  const ctx  = usePageContext() as { routeParams?: { slug?: string } }
  const slug = ctx.routeParams?.slug ?? ''
  const post = POSTS[slug] ?? { title: slug || 'Unknown', body: 'Slug not in the prerender list.' }
  return (
    <div className="page">
      <SiteHeader />
      <section className="hero">
        <h1 className="hero-title">{post.title}</h1>
        <p className="hero-lead">{post.body}</p>
        <p className="feature-desc">URL slug: <code className="inline-code">{slug}</code></p>
        <p className="feature-desc">
          Try <a href="/demos/prerender-dynamic/alpha">/alpha</a> or{' '}
          <a href="/demos/prerender-dynamic/beta">/beta</a>.
        </p>
      </section>
    </div>
  )
}
