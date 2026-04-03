import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'RudderJS',
  description: 'Laravel-inspired Node.js full-stack framework built on Vike + Vite',
  lang: 'en-US',

  head: [
    ['link', { rel: 'icon', type: 'image/png', href: '/logo.png' }],
    ['meta', { name: 'theme-color', content: '#f97316' }],
  ],

  themeConfig: {
    logo: '/logo.png',
    siteTitle: 'RudderJS',

    nav: [
      { text: 'Guide', link: '/guide/', activeMatch: '/guide/' },
      { text: 'Packages', link: '/packages/', activeMatch: '/packages/' },
      { text: 'CLI', link: '/cli/', activeMatch: '/cli/' },
      { text: 'Integrations', link: '/integrations/', activeMatch: '/integrations/' },
      { text: 'Contributing', link: '/contributing/', activeMatch: '/contributing/' },
      {
        text: 'v0.1.0',
        items: [
          { text: 'Changelog', link: 'https://github.com/rudderjs/rudder/releases' },
          { text: 'Contributing Guide', link: '/contributing/' },
        ],
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'What is RudderJS?', link: '/guide/' },
            { text: 'Installation', link: '/guide/installation' },
            { text: 'Your First App', link: '/guide/your-first-app' },
            { text: 'Directory Structure', link: '/guide/directory-structure' },
            { text: 'Coming from Next.js', link: '/guide/coming-from-nextjs' },
          ],
        },
        {
          text: 'Core Concepts',
          items: [
            { text: 'Configuration', link: '/guide/configuration' },
            { text: 'Service Providers', link: '/guide/service-providers' },
            { text: 'Dependency Injection', link: '/guide/dependency-injection' },
            { text: 'Routing', link: '/guide/routing' },
            { text: 'Middleware', link: '/guide/middleware' },
            { text: 'Validation', link: '/guide/validation' },
            { text: 'Database & Models', link: '/guide/database' },
            { text: 'Frontend Pages & SSR', link: '/guide/frontend-pages' },
            { text: 'Rudder Console', link: '/guide/rudder' },
          ],
        },
        {
          text: 'Real-time',
          items: [
            { text: 'Broadcasting & Live', link: '/guide/websockets' },
          ],
        },
        {
          text: 'Admin & Panels',
          items: [
            { text: 'Panels', link: '/guide/panels' },
          ],
        },
      ],

      '/packages/': [
        {
          text: 'Core',
          items: [
            { text: 'Package Catalog', link: '/packages/' },
            { text: '@rudderjs/core', link: '/packages/core/' },
            { text: '@rudderjs/contracts', link: '/packages/core/contracts' },
            { text: '@rudderjs/support', link: '/packages/core/support' },
            { text: 'DI Container', link: '/packages/core/di' },
            { text: '@rudderjs/middleware', link: '/packages/core/middleware' },
            { text: 'Rate Limiting & CSRF', link: '/packages/rate-limit' },
            { text: 'Validation (core)', link: '/packages/core/validation' },
          ],
        },
        {
          text: 'Build',
          items: [
            { text: '@rudderjs/vite', link: '/packages/vite/' },
            { text: '@rudderjs/image', link: '/packages/image/' },
          ],
        },
        {
          text: 'Server',
          items: [
            { text: '@rudderjs/router', link: '/packages/server/router' },
            { text: '@rudderjs/server-hono', link: '/packages/server/hono' },
          ],
        },
        {
          text: 'ORM',
          items: [
            { text: '@rudderjs/orm', link: '/packages/orm/' },
            { text: '@rudderjs/orm-prisma', link: '/packages/orm/prisma' },
            { text: '@rudderjs/orm-drizzle', link: '/packages/orm/drizzle' },
          ],
        },
        {
          text: 'Queue',
          items: [
            { text: '@rudderjs/queue', link: '/packages/queue/' },
            { text: '@rudderjs/queue-bullmq', link: '/packages/queue/bullmq' },
            { text: '@rudderjs/queue-inngest', link: '/packages/queue/inngest' },
          ],
        },
        {
          text: 'Auth',
          items: [
            { text: '@rudderjs/auth', link: '/packages/auth/' },
            { text: 'Setup with better-auth', link: '/packages/auth/better-auth' },
          ],
        },
        {
          text: 'Session',
          items: [
            { text: '@rudderjs/session', link: '/packages/session' },
          ],
        },
        {
          text: 'Cache',
          items: [
            { text: '@rudderjs/cache', link: '/packages/cache/' },
            { text: 'Redis Driver', link: '/packages/cache/redis' },
          ],
        },
        {
          text: 'Storage',
          items: [
            { text: '@rudderjs/storage', link: '/packages/storage/' },
            { text: 'S3 / R2 / MinIO', link: '/packages/storage/s3' },
          ],
        },
        {
          text: 'Mail',
          items: [
            { text: '@rudderjs/mail', link: '/packages/mail/' },
            { text: 'SMTP (Nodemailer)', link: '/packages/mail/nodemailer' },
          ],
        },
        {
          text: 'Real-time',
          items: [
            { text: '@rudderjs/broadcast', link: '/packages/broadcast' },
            { text: '@rudderjs/live', link: '/packages/live' },
          ],
        },
        {
          text: 'Features',
          items: [
            { text: 'Events (core)', link: '/packages/events' },
            { text: '@rudderjs/schedule', link: '/packages/schedule' },
            { text: '@rudderjs/notification', link: '/packages/notification' },
            { text: '@rudderjs/rudder', link: '/packages/rudder' },
          ],
        },
        {
          text: 'AI',
          items: [
            { text: 'Overview', link: '/packages/ai/' },
            { text: 'Agents', link: '/packages/ai/agents' },
            { text: 'Tools', link: '/packages/ai/tools' },
            { text: 'Streaming', link: '/packages/ai/streaming' },
            { text: 'Middleware & Testing', link: '/packages/ai/middleware' },
          ],
        },
        {
          text: 'Panels',
          items: [
            { text: 'Overview', link: '/packages/panels/' },
            { text: 'Resources', link: '/packages/panels/resources' },
            { text: 'Fields', link: '/packages/panels/fields' },
            { text: 'Listing Records', link: '/packages/panels/listing' },
            { text: 'Schema Elements', link: '/packages/panels/schema' },
            { text: 'Navigation', link: '/packages/panels/navigation' },
            { text: 'Globals', link: '/packages/panels/globals' },
            { text: 'Custom Pages', link: '/packages/panels/pages' },
            { text: 'Editor', link: '/packages/panels/editor' },
            { text: 'AI Agents', link: '/packages/panels/agents' },
            { text: 'Media Library', link: '/packages/media/' },
            { text: 'API Routes', link: '/packages/panels/api' },
          ],
        },
      ],

      '/cli/': [
        {
          text: 'RudderJS CLI',
          items: [
            { text: 'Overview', link: '/cli/' },
            { text: 'make: Commands', link: '/cli/make-commands' },
            { text: 'module: Commands', link: '/cli/module-commands' },
          ],
        },
      ],

      '/integrations/': [
        {
          text: 'Integrations',
          items: [
            { text: 'Authentication', link: '/integrations/auth' },
            { text: 'Notifications', link: '/integrations/notifications' },
            { text: 'Deployment', link: '/integrations/deployment' },
          ],
        },
      ],

      '/contributing/': [
        {
          text: 'Contributing',
          items: [
            { text: 'Overview', link: '/contributing/' },
            { text: 'Creating a New Package', link: '/contributing/new-package' },
            { text: 'Creating a Panels Extension', link: '/contributing/panels-extension' },
            { text: 'Dynamic Providers', link: '/contributing/dynamic-providers' },
          ],
        },
      ],
    },

    search: {
      provider: 'local',
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/rudderjs/rudder' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026-present Suleiman Shahbari',
    },

    editLink: {
      pattern: 'https://github.com/rudderjs/rudder/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },

  markdown: {
    theme: { light: 'github-light', dark: 'github-dark' },
    lineNumbers: true,
  },
})
