// Polymorphic relations demo — morphMany / morphTo via @rudderjs/orm.
//
// Scaffolds three Models (Post / Video / Comment), the React view, the
// `Comment` table's polymorphic columns (`commentableId` / `commentableType`,
// camelCase per ORM convention), the controller view, and a self-contained
// API surface (state + create + comment + parent-resolution).

export function postModelTs(): string {
  return `import { Model } from '@rudderjs/orm'
import { Comment } from './Comment.js'

export class Post extends Model {
  static table = 'post'
  static fillable = ['title']

  static override relations = {
    comments: { type: 'morphMany' as const, model: () => Comment, morphName: 'commentable' },
  }

  id!:        number
  title!:     string
  createdAt!: Date
}
`
}

export function videoModelTs(): string {
  return `import { Model } from '@rudderjs/orm'
import { Comment } from './Comment.js'

export class Video extends Model {
  static table = 'video'
  static fillable = ['url']

  static override relations = {
    comments: { type: 'morphMany' as const, model: () => Comment, morphName: 'commentable' },
  }

  id!:        number
  url!:       string
  createdAt!: Date
}
`
}

export function commentModelTs(): string {
  return `import { Model } from '@rudderjs/orm'
import { Post } from './Post.js'
import { Video } from './Video.js'

export class Comment extends Model {
  static table = 'comment'
  static fillable = ['body', 'commentableId', 'commentableType']

  static override relations = {
    commentable: { type: 'morphTo' as const, morphName: 'commentable', types: () => [Post, Video] },
  }

  id!:              number
  body!:            string
  commentableId!:   number
  commentableType!: string
  createdAt!:       Date
}
`
}

export function polymorphicPrismaBlock(): string {
  return `// module: Polymorphic demo (Post / Video / Comment)
// commentableId + commentableType follow @rudderjs/orm's camelCase convention.
model Post {
  id        Int      @id @default(autoincrement())
  title     String
  createdAt DateTime @default(now())
}

model Video {
  id        Int      @id @default(autoincrement())
  url       String
  createdAt DateTime @default(now())
}

model Comment {
  id              Int      @id @default(autoincrement())
  body            String
  commentableId   Int
  commentableType String
  createdAt       DateTime @default(now())

  @@index([commentableType, commentableId])
}
`
}

export function demosPolymorphicView(): string {
  return `import '@/index.css'
import { useState } from 'react'

interface CommentDto {
  id:              number
  body:            string
  commentableId:   number
  commentableType: string
  createdAt:       string
}

interface PostDto {
  id:       number
  title:    string
  comments: CommentDto[]
}

interface VideoDto {
  id:       number
  url:      string
  comments: CommentDto[]
}

interface ResolvedParent {
  type:  'Post' | 'Video'
  id:    number
  title: string
}

interface PolymorphicDemoProps {
  posts:  PostDto[]
  videos: VideoDto[]
}

export default function PolymorphicDemo({ posts: initialPosts, videos: initialVideos }: PolymorphicDemoProps) {
  const [posts, setPosts]   = useState<PostDto[]>(initialPosts)
  const [videos, setVideos] = useState<VideoDto[]>(initialVideos)
  const [resolved, setResolved] = useState<ResolvedParent | null>(null)
  const [loading, setLoading] = useState(false)

  async function refresh() {
    const res = await fetch('/api/polymorphic/state')
    const json = await res.json() as { posts: PostDto[]; videos: VideoDto[] }
    setPosts(json.posts)
    setVideos(json.videos)
  }

  async function addPost() {
    const title = prompt('Post title?')
    if (!title) return
    setLoading(true)
    try {
      await fetch('/api/polymorphic/posts', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ title }),
      })
      await refresh()
    } finally { setLoading(false) }
  }

  async function addVideo() {
    const url = prompt('Video URL?')
    if (!url) return
    setLoading(true)
    try {
      await fetch('/api/polymorphic/videos', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ url }),
      })
      await refresh()
    } finally { setLoading(false) }
  }

  async function addComment(type: 'post' | 'video', id: number) {
    const body = prompt(\`Comment on \${type} #\${id}?\`)
    if (!body) return
    setLoading(true)
    try {
      await fetch(\`/api/polymorphic/\${type}s/\${id}/comments\`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ body }),
      })
      await refresh()
    } finally { setLoading(false) }
  }

  async function resolveParent(commentId: number) {
    setLoading(true)
    try {
      const res = await fetch(\`/api/polymorphic/comments/\${commentId}/parent\`)
      setResolved(await res.json() as ResolvedParent)
    } finally { setLoading(false) }
  }

  return (
    <div className="page">
      <nav className="page-nav">
        <div className="brand">
          <span className="brand-dot" />
          RudderJS
        </div>
        <div className="nav-right">
          <a href="/demos" className="nav-link">Demos</a>
          <a href="/" className="nav-link">Home</a>
        </div>
      </nav>

      <section className="hero">
        <h1 className="hero-title">Polymorphic relations</h1>
        <p className="hero-lead">
          One <code className="inline-code">Comment</code> table belonging to either a <code className="inline-code">Post</code> or a <code className="inline-code">Video</code> via <code className="inline-code">commentableId</code> + <code className="inline-code">commentableType</code> (camelCase, ORM convention). Add comments to either side; click "Resolve parent" to watch <code className="inline-code">comment.related('commentable').first()</code> branch through the closed <code className="inline-code">types: () =&gt; [Post, Video]</code> list.
        </p>
        <p className="hero-meta">
          Models: <code className="inline-code">Post.morphMany('comments')</code>, <code className="inline-code">Video.morphMany('comments')</code>, <code className="inline-code">Comment.morphTo('commentable', [Post, Video])</code>. Writes use <code className="inline-code">Model.morph('commentable', parent)</code>.
        </p>
      </section>

      <section className="feature-section">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', maxWidth: '60rem', margin: '0 auto' }}>
          <div className="demo-card">
            <div className="demo-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 className="demo-card-title">Posts</h2>
              <button className="button-primary" onClick={addPost} disabled={loading}>+ Post</button>
            </div>
            <div className="demo-card-body">
              {posts.length === 0 && <p className="empty-state">No posts yet.</p>}
              {posts.map(p => (
                <div key={p.id} style={{ borderBottom: '1px solid var(--border, #e5e7eb)', padding: '0.75rem 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>#{p.id} — {p.title}</strong>
                    <button onClick={() => addComment('post', p.id)} disabled={loading} style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}>+ Comment</button>
                  </div>
                  <ul style={{ marginTop: '0.5rem', paddingLeft: '1rem', fontSize: '0.85rem' }}>
                    {p.comments.map(c => (
                      <li key={c.id} style={{ marginBottom: '0.25rem' }}>
                        {c.body} <button onClick={() => resolveParent(c.id)} style={{ fontSize: '0.7rem', marginLeft: '0.5rem' }}>resolve</button>
                      </li>
                    ))}
                    {p.comments.length === 0 && <li style={{ color: 'var(--text-muted, #888)' }}>(no comments)</li>}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          <div className="demo-card">
            <div className="demo-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 className="demo-card-title">Videos</h2>
              <button className="button-primary" onClick={addVideo} disabled={loading}>+ Video</button>
            </div>
            <div className="demo-card-body">
              {videos.length === 0 && <p className="empty-state">No videos yet.</p>}
              {videos.map(v => (
                <div key={v.id} style={{ borderBottom: '1px solid var(--border, #e5e7eb)', padding: '0.75rem 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>#{v.id} — {v.url}</strong>
                    <button onClick={() => addComment('video', v.id)} disabled={loading} style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}>+ Comment</button>
                  </div>
                  <ul style={{ marginTop: '0.5rem', paddingLeft: '1rem', fontSize: '0.85rem' }}>
                    {v.comments.map(c => (
                      <li key={c.id} style={{ marginBottom: '0.25rem' }}>
                        {c.body} <button onClick={() => resolveParent(c.id)} style={{ fontSize: '0.7rem', marginLeft: '0.5rem' }}>resolve</button>
                      </li>
                    ))}
                    {v.comments.length === 0 && <li style={{ color: 'var(--text-muted, #888)' }}>(no comments)</li>}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>

        {resolved && (
          <div className="demo-card" style={{ maxWidth: '40rem', margin: '1rem auto 0' }}>
            <div className="demo-card-header"><h2 className="demo-card-title">morphTo resolved</h2></div>
            <div className="demo-card-body">
              <code className="inline-code">comment.related('commentable').first()</code> ⇒ <strong>{resolved.type}</strong> #{resolved.id} — {resolved.title}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
`
}

/**
 * Inlined into routes/web.ts demos block. Loads parents + hydrates each parent's
 * comments via the morphMany relation. Returns plain objects (Vike refuses to
 * serialize Model instances across the SSR boundary).
 */
export function demosPolymorphicWebBlock(): string {
  return `Route.get('/demos/polymorphic', async () => {
  const [posts, videos] = await Promise.all([Post.all(), Video.all()])
  const hydrate = async (parent: Post | Video) => {
    const comments = await (parent as unknown as { related(n: string): { get(): Promise<Comment[]> } })
      .related('comments').get()
    return { ...parent, comments: comments.map(c => ({ ...c })) }
  }
  return view('demos.polymorphic', {
    posts:  await Promise.all(posts.map(hydrate)),
    videos: await Promise.all(videos.map(hydrate)),
  })
})`
}

/**
 * Inlined into routes/api.ts demos block. Six endpoints: state, create-post,
 * create-video, comment-on-post, comment-on-video, resolve-parent (morphTo).
 */
export function demosPolymorphicApiBlock(): string {
  return `// ── /demos/polymorphic — morphMany / morphTo via @rudderjs/orm ──────────────

// GET /api/polymorphic/state — posts + videos with their comments hydrated.
router.get('/api/polymorphic/state', async (_req, res) => {
  const [posts, videos] = await Promise.all([Post.all(), Video.all()])
  const hydrate = async (parent: Post | Video) => {
    const comments = await (parent as unknown as { related(n: string): { get(): Promise<Comment[]> } })
      .related('comments').get()
    return { ...parent, comments: comments.map(c => ({ ...c })) }
  }
  res.json({
    posts:  await Promise.all(posts.map(hydrate)),
    videos: await Promise.all(videos.map(hydrate)),
  })
})

// POST /api/polymorphic/posts — create a post.
router.post('/api/polymorphic/posts', async (req, res) => {
  const { title } = (req.body ?? {}) as { title?: string }
  if (!title) return res.status(400).json({ error: 'title required' })
  const post = await Post.create({ title })
  res.status(201).json({ ...post })
})

// POST /api/polymorphic/videos — create a video.
router.post('/api/polymorphic/videos', async (req, res) => {
  const { url } = (req.body ?? {}) as { url?: string }
  if (!url) return res.status(400).json({ error: 'url required' })
  const video = await Video.create({ url })
  res.status(201).json({ ...video })
})

// POST /api/polymorphic/(posts|videos)/:id/comments — Model.morph() write.
router.post('/api/polymorphic/posts/:id/comments', async (req, res) => {
  const idParam = req.params['id']
  if (!idParam) return res.status(400).json({ error: 'id required' })
  const post = await Post.find(Number(idParam))
  if (!post) return res.status(404).json({ error: 'post not found' })
  const { body } = (req.body ?? {}) as { body?: string }
  if (!body) return res.status(400).json({ error: 'body required' })
  const comment = await Comment.create({ body, ...Model.morph('commentable', post) })
  res.status(201).json({ ...comment })
})

router.post('/api/polymorphic/videos/:id/comments', async (req, res) => {
  const idParam = req.params['id']
  if (!idParam) return res.status(400).json({ error: 'id required' })
  const video = await Video.find(Number(idParam))
  if (!video) return res.status(404).json({ error: 'video not found' })
  const { body } = (req.body ?? {}) as { body?: string }
  if (!body) return res.status(400).json({ error: 'body required' })
  const comment = await Comment.create({ body, ...Model.morph('commentable', video) })
  res.status(201).json({ ...comment })
})

// GET /api/polymorphic/comments/:id/parent — morphTo resolution via the closed
// types: () => [Post, Video] list. Branches on commentableType under the hood.
router.get('/api/polymorphic/comments/:id/parent', async (req, res) => {
  const idParam = req.params['id']
  if (!idParam) return res.status(400).json({ error: 'id required' })
  const comment = await Comment.find(Number(idParam))
  if (!comment) return res.status(404).json({ error: 'comment not found' })

  const parent = await (comment as unknown as { related(n: string): { first(): Promise<Post | Video | null> } })
    .related('commentable').first()
  if (!parent) return res.status(404).json({ error: 'parent not found' })

  res.json({
    type:  comment.commentableType,
    id:    parent.id,
    title: 'title' in parent ? parent.title : parent.url,
  })
})`
}
