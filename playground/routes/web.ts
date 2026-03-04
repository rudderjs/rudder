import { router } from '@boostkit/router'

// Web routes — HTML redirects, guards, and non-API server responses
// These run before Vike's file-based page routing
// Use this file for: redirects, server-side auth guards, download routes, sitemaps, etc.

// Example: redirect root to /todos
// router.get('/', (_req, res) => res.redirect('/todos'))

// Example: sitemap
router.get('/test-get-route', (_req, res) => {
  // return 'sdsd';
  // res.header('Content-Type', 'application/xml')
  res.send(`test response`);
})
