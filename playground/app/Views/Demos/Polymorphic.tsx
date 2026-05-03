import { useState } from 'react'
import '@/index.css'

interface CommentDto {
  id:              number
  body:            string
  commentableId:   number
  commentableType: string
  createdAt:       string
}

interface PostDto {
  id:        number
  title:     string
  comments:  CommentDto[]
}

interface VideoDto {
  id:        number
  url:       string
  comments:  CommentDto[]
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
    const body = prompt(`Comment on ${type} #${id}?`)
    if (!body) return
    setLoading(true)
    try {
      await fetch(`/api/polymorphic/${type}s/${id}/comments`, {
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
      const res = await fetch(`/api/polymorphic/comments/${commentId}/parent`)
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
