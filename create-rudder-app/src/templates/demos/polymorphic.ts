// Polymorphic relations demo — every polymorphic relation type
// (morphMany / morphTo / morphToMany / morphedByMany) via @rudderjs/orm.
//
// Scaffolds four Models (Post / Video / Comment / Tag), the React view, the
// Prisma block (Comment with camelCase commentableId/commentableType + Tag
// with the shared `taggable` pivot), the controller view, and a self-contained
// API surface (state, create, comment, morphTo resolution, tag attach/detach,
// and morphedByMany inverse fan-out).

export function postModelTs(): string {
  return `import { Model } from '@rudderjs/orm'
import { Comment } from './Comment.js'
import { Tag } from './Tag.js'

export class Post extends Model {
  static table = 'post'
  static fillable = ['title']

  static override relations = {
    comments: { type: 'morphMany'   as const, model: () => Comment, morphName: 'commentable' },
    tags:     { type: 'morphToMany' as const, model: () => Tag,     pivotTable: 'taggable', morphName: 'taggable' },
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
import { Tag } from './Tag.js'

export class Video extends Model {
  static table = 'video'
  static fillable = ['url']

  static override relations = {
    comments: { type: 'morphMany'   as const, model: () => Comment, morphName: 'commentable' },
    tags:     { type: 'morphToMany' as const, model: () => Tag,     pivotTable: 'taggable', morphName: 'taggable' },
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

export function tagModelTs(): string {
  return `import { Model } from '@rudderjs/orm'
import { Post } from './Post.js'
import { Video } from './Video.js'

export class Tag extends Model {
  static table = 'tag'
  static fillable = ['name']

  static override relations = {
    posts: {
      type:       'morphedByMany' as const,
      model:      () => Post,
      pivotTable: 'taggable',
      morphName:  'taggable',
    },
    videos: {
      type:       'morphedByMany' as const,
      model:      () => Video,
      pivotTable: 'taggable',
      morphName:  'taggable',
    },
  }

  id!:   number
  name!: string
}
`
}

export function polymorphicPrismaBlock(): string {
  return `// module: Polymorphic demo (Post / Video / Comment / Tag + Taggable pivot)
// commentableId/commentableType + taggableId/taggableType follow @rudderjs/orm's
// camelCase convention.
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

// Polymorphic many-to-many. One Tag table shared by both Post and Video
// through a single Taggable pivot. The pivot carries tagId (strong side) +
// taggableId/taggableType (polymorphic side).
model Tag {
  id   Int    @id @default(autoincrement())
  name String @unique
}

model Taggable {
  tagId         Int
  taggableId    Int
  taggableType  String

  @@id([tagId, taggableId, taggableType])
  @@index([taggableId, taggableType])
}
`
}

export function demosPolymorphicView(): string {
  return `import '@/index.css'
import { SiteHeader } from 'App/Components/SiteHeader.js'
import { useState } from 'react'

interface CommentDto {
  id:              number
  body:            string
  commentableId:   number
  commentableType: string
  createdAt:       string
}

interface TagDto {
  id:   number
  name: string
}

interface PostDto {
  id:       number
  title:    string
  comments: CommentDto[]
  tags:     TagDto[]
}

interface VideoDto {
  id:       number
  url:      string
  comments: CommentDto[]
  tags:     TagDto[]
}

interface ResolvedParent {
  type:  'Post' | 'Video'
  id:    number
  title: string
}

interface InverseFanOut {
  posts:  Array<{ id: number; title: string }>
  videos: Array<{ id: number; url:   string }>
}

interface PolymorphicDemoProps {
  posts:  PostDto[]
  videos: VideoDto[]
  tags:   TagDto[]
}

export default function PolymorphicDemo(props: PolymorphicDemoProps) {
  const [posts, setPosts]   = useState<PostDto[]>(props.posts)
  const [videos, setVideos] = useState<VideoDto[]>(props.videos)
  const [tags, setTags]     = useState<TagDto[]>(props.tags)
  const [resolved, setResolved] = useState<ResolvedParent | null>(null)
  const [inverse, setInverse]   = useState<{ tag: TagDto; data: InverseFanOut } | null>(null)
  const [loading, setLoading] = useState(false)

  async function refresh() {
    const res = await fetch('/api/polymorphic/state')
    const json = await res.json() as { posts: PostDto[]; videos: VideoDto[]; tags: TagDto[] }
    setPosts(json.posts)
    setVideos(json.videos)
    setTags(json.tags)
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

  async function addTag() {
    const name = prompt('Tag name?')
    if (!name) return
    setLoading(true)
    try {
      await fetch('/api/polymorphic/tags', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name }),
      })
      await refresh()
    } finally { setLoading(false) }
  }

  async function attachTag(type: 'post' | 'video', parentId: number) {
    if (tags.length === 0) { alert('Create a tag first.'); return }
    const tagName = prompt(\`Attach which tag? (\${tags.map(t => t.name).join(', ')})\`)
    if (!tagName) return
    const tag = tags.find(t => t.name === tagName)
    if (!tag) { alert('No tag with that name.'); return }
    setLoading(true)
    try {
      await fetch(\`/api/polymorphic/\${type}s/\${parentId}/tags\`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tagId: tag.id }),
      })
      await refresh()
    } finally { setLoading(false) }
  }

  async function detachTag(type: 'post' | 'video', parentId: number, tagId: number) {
    setLoading(true)
    try {
      await fetch(\`/api/polymorphic/\${type}s/\${parentId}/tags/\${tagId}\`, { method: 'DELETE' })
      await refresh()
    } finally { setLoading(false) }
  }

  async function resolveInverse(tag: TagDto) {
    setLoading(true)
    try {
      const res = await fetch(\`/api/polymorphic/tags/\${tag.id}/items\`)
      setInverse({ tag, data: await res.json() as InverseFanOut })
    } finally { setLoading(false) }
  }

  return (
    <div className="page">
      <SiteHeader />

      <section className="hero">
        <h1 className="hero-title">Polymorphic relations</h1>
        <p className="hero-lead">
          One <code className="inline-code">Comment</code> table belonging to either a <code className="inline-code">Post</code> or a <code className="inline-code">Video</code> via <code className="inline-code">commentableId</code> + <code className="inline-code">commentableType</code>. One <code className="inline-code">Tag</code> table shared by both Posts and Videos through a single <code className="inline-code">taggable</code> pivot — <code className="inline-code">morphToMany</code> on the owning side, <code className="inline-code">morphedByMany</code> on the inverse.
        </p>
        <p className="hero-meta">
          Models: <code className="inline-code">Post.morphMany('comments')</code> + <code className="inline-code">Post.morphToMany('tags')</code>, <code className="inline-code">Video.morphMany('comments')</code> + <code className="inline-code">Video.morphToMany('tags')</code>, <code className="inline-code">Comment.morphTo('commentable', [Post, Video])</code>, <code className="inline-code">Tag.morphedByMany('posts'|'videos')</code>. Writes use <code className="inline-code">Model.morph()</code> + <code className="inline-code">Model.morphToMany().attach()</code>.
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
                    <span style={{ display: 'flex', gap: '0.25rem' }}>
                      <button onClick={() => addComment('post', p.id)} disabled={loading} style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}>+ Comment</button>
                      <button onClick={() => attachTag('post', p.id)} disabled={loading} style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}>+ Tag</button>
                    </span>
                  </div>
                  {p.tags.length > 0 && (
                    <div style={{ marginTop: '0.4rem', display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                      {p.tags.map(t => (
                        <button
                          key={t.id}
                          onClick={() => detachTag('post', p.id, t.id)}
                          disabled={loading}
                          title="Click to detach"
                          style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '999px', background: '#dbeafe', color: '#1e40af', border: '1px solid #93c5fd', cursor: 'pointer' }}
                        >
                          {t.name} ×
                        </button>
                      ))}
                    </div>
                  )}
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
                    <span style={{ display: 'flex', gap: '0.25rem' }}>
                      <button onClick={() => addComment('video', v.id)} disabled={loading} style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}>+ Comment</button>
                      <button onClick={() => attachTag('video', v.id)} disabled={loading} style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}>+ Tag</button>
                    </span>
                  </div>
                  {v.tags.length > 0 && (
                    <div style={{ marginTop: '0.4rem', display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                      {v.tags.map(t => (
                        <button
                          key={t.id}
                          onClick={() => detachTag('video', v.id, t.id)}
                          disabled={loading}
                          title="Click to detach"
                          style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '999px', background: '#fce7f3', color: '#9d174d', border: '1px solid #f9a8d4', cursor: 'pointer' }}
                        >
                          {t.name} ×
                        </button>
                      ))}
                    </div>
                  )}
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

        <div className="demo-card" style={{ maxWidth: '60rem', margin: '1rem auto 0' }}>
          <div className="demo-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 className="demo-card-title">Tags (shared)</h2>
            <button className="button-primary" onClick={addTag} disabled={loading}>+ Tag</button>
          </div>
          <div className="demo-card-body">
            {tags.length === 0 && <p className="empty-state">No tags yet.</p>}
            {tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {tags.map(t => (
                  <button
                    key={t.id}
                    onClick={() => resolveInverse(t)}
                    disabled={loading}
                    title="Show every Post + Video tagged with this"
                    style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem', borderRadius: '999px', background: '#f3f4f6', border: '1px solid #d1d5db', cursor: 'pointer' }}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            )}
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

        {inverse && (
          <div className="demo-card" style={{ maxWidth: '60rem', margin: '1rem auto 0' }}>
            <div className="demo-card-header"><h2 className="demo-card-title">morphedByMany resolved — tag "{inverse.tag.name}"</h2></div>
            <div className="demo-card-body">
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted, #888)' }}>
                <code className="inline-code">tag.related('posts').get()</code> + <code className="inline-code">tag.related('videos').get()</code> — one pivot, two scoped reads.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '0.5rem' }}>
                <div>
                  <strong style={{ fontSize: '0.85rem' }}>Posts ({inverse.data.posts.length})</strong>
                  <ul style={{ paddingLeft: '1rem', fontSize: '0.85rem' }}>
                    {inverse.data.posts.map(p => <li key={p.id}>#{p.id} — {p.title}</li>)}
                    {inverse.data.posts.length === 0 && <li style={{ color: 'var(--text-muted, #888)' }}>(none)</li>}
                  </ul>
                </div>
                <div>
                  <strong style={{ fontSize: '0.85rem' }}>Videos ({inverse.data.videos.length})</strong>
                  <ul style={{ paddingLeft: '1rem', fontSize: '0.85rem' }}>
                    {inverse.data.videos.map(v => <li key={v.id}>#{v.id} — {v.url}</li>)}
                    {inverse.data.videos.length === 0 && <li style={{ color: 'var(--text-muted, #888)' }}>(none)</li>}
                  </ul>
                </div>
              </div>
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
 * comments + tags via the polymorphic relations. Returns plain objects (Vike
 * refuses to serialize Model instances across the SSR boundary).
 */
export function demosPolymorphicWebBlock(): string {
  return `Route.get('/demos/polymorphic', async () => {
  const [posts, videos, tags] = await Promise.all([Post.all(), Video.all(), Tag.all()])
  type WithRelated = { related(n: string): { get(): Promise<unknown[]> } }
  const hydrate = async (parent: Post | Video) => {
    const r = parent as unknown as WithRelated
    const [comments, ptags] = await Promise.all([
      r.related('comments').get() as Promise<Comment[]>,
      r.related('tags').get()     as Promise<Tag[]>,
    ])
    return {
      ...parent,
      comments: comments.map(c => ({ ...c })),
      tags:     ptags.map(t => ({ ...t })),
    }
  }
  return view('demos.polymorphic', {
    posts:  await Promise.all(posts.map(hydrate)),
    videos: await Promise.all(videos.map(hydrate)),
    tags:   tags.map(t => ({ ...t })),
  })
})`
}

/**
 * Inlined into routes/api.ts demos block. Endpoints: state, create-post,
 * create-video, comment-on-post, comment-on-video, morphTo resolution,
 * create-tag, attach/detach tag (post + video), morphedByMany inverse.
 */
export function demosPolymorphicApiBlock(): string {
  return `// ── /demos/polymorphic — every polymorphic relation type via @rudderjs/orm ──

// GET /api/polymorphic/state — posts + videos with comments + tags + the flat tag list.
router.get('/api/polymorphic/state', async (_req, res) => {
  const [posts, videos, tags] = await Promise.all([Post.all(), Video.all(), Tag.all()])
  const hydrate = async (parent: Post | Video) => {
    const r = parent as unknown as { related(n: string): { get(): Promise<unknown[]> } }
    const [comments, ptags] = await Promise.all([
      r.related('comments').get() as Promise<Comment[]>,
      r.related('tags').get()     as Promise<Tag[]>,
    ])
    return {
      ...parent,
      comments: comments.map(c => ({ ...c })),
      tags:     ptags.map(t => ({ ...t })),
    }
  }
  res.json({
    posts:  await Promise.all(posts.map(hydrate)),
    videos: await Promise.all(videos.map(hydrate)),
    tags:   tags.map(t => ({ ...t })),
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

// GET /api/polymorphic/comments/:id/parent — morphTo resolution.
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
})

// ── morphToMany / morphedByMany — Tag endpoints ────────────────────────────

// POST /api/polymorphic/tags — create a tag.
router.post('/api/polymorphic/tags', async (req, res) => {
  const { name } = (req.body ?? {}) as { name?: string }
  if (!name) return res.status(400).json({ error: 'name required' })
  const tag = await Tag.create({ name })
  res.status(201).json({ ...tag })
})

// POST /api/polymorphic/posts/:id/tags — morphToMany attach. The pivot row
// carries taggableType='Post' automatically.
router.post('/api/polymorphic/posts/:id/tags', async (req, res) => {
  const idParam = req.params['id']
  if (!idParam) return res.status(400).json({ error: 'id required' })
  const post = await Post.find(Number(idParam))
  if (!post) return res.status(404).json({ error: 'post not found' })
  const { tagId } = (req.body ?? {}) as { tagId?: number }
  if (typeof tagId !== 'number') return res.status(400).json({ error: 'tagId required' })
  await Model.morphToMany(post, 'tags').attach([tagId])
  res.json({ ok: true })
})

router.post('/api/polymorphic/videos/:id/tags', async (req, res) => {
  const idParam = req.params['id']
  if (!idParam) return res.status(400).json({ error: 'id required' })
  const video = await Video.find(Number(idParam))
  if (!video) return res.status(404).json({ error: 'video not found' })
  const { tagId } = (req.body ?? {}) as { tagId?: number }
  if (typeof tagId !== 'number') return res.status(400).json({ error: 'tagId required' })
  await Model.morphToMany(video, 'tags').attach([tagId])
  res.json({ ok: true })
})

// DELETE /api/polymorphic/(posts|videos)/:id/tags/:tagId — morphToMany detach
// scoped to the parent's discriminator (videos sharing the tag are untouched).
router.delete('/api/polymorphic/posts/:id/tags/:tagId', async (req, res) => {
  const id = req.params['id']; const tagId = req.params['tagId']
  if (!id || !tagId) return res.status(400).json({ error: 'id/tagId required' })
  const post = await Post.find(Number(id))
  if (!post) return res.status(404).json({ error: 'post not found' })
  await Model.morphToMany(post, 'tags').detach([Number(tagId)])
  res.json({ ok: true })
})

router.delete('/api/polymorphic/videos/:id/tags/:tagId', async (req, res) => {
  const id = req.params['id']; const tagId = req.params['tagId']
  if (!id || !tagId) return res.status(400).json({ error: 'id/tagId required' })
  const video = await Video.find(Number(id))
  if (!video) return res.status(404).json({ error: 'video not found' })
  await Model.morphToMany(video, 'tags').detach([Number(tagId)])
  res.json({ ok: true })
})

// GET /api/polymorphic/tags/:id/items — morphedByMany inverse fan-out.
// One pivot, two scoped reads (one per concrete inverse class).
router.get('/api/polymorphic/tags/:id/items', async (req, res) => {
  const idParam = req.params['id']
  if (!idParam) return res.status(400).json({ error: 'id required' })
  const tag = await Tag.find(Number(idParam))
  if (!tag) return res.status(404).json({ error: 'tag not found' })
  const r = tag as unknown as { related(n: string): { get(): Promise<unknown[]> } }
  const [posts, videos] = await Promise.all([
    r.related('posts').get()  as Promise<Post[]>,
    r.related('videos').get() as Promise<Video[]>,
  ])
  res.json({
    posts:  posts.map(p  => ({ ...p })),
    videos: videos.map(v => ({ ...v })),
  })
})`
}
