import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'BoostKit',
  description: 'Laravel-inspired Node.js full-stack framework built on Vike + Vite',
  lang: 'en-US',

  head: [
    ['link', { rel: 'icon', type: 'image/png', href: '/logo.png' }],
    ['meta', { name: 'theme-color', content: '#f97316' }],
  ],

  themeConfig: {
    logo: '/logo.png',
    siteTitle: 'BoostKit',

    nav: [
      { text: 'Guide', link: '/guide/', activeMatch: '/guide/' },
      { text: 'Packages', link: '/packages/', activeMatch: '/packages/' },
      { text: 'CLI', link: '/cli/', activeMatch: '/cli/' },
      { text: 'Integrations', link: '/integrations/', activeMatch: '/integrations/' },
      {
        text: 'v0.0.2',
        items: [
          { text: 'Changelog', link: 'https://github.com/boostkitjs/boostkit/releases' },
          { text: 'Contributing', link: 'https://github.com/boostkitjs/boostkit/blob/main/CONTRIBUTING.md' },
        ],
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'What is BoostKit?', link: '/guide/' },
            { text: 'Installation', link: '/guide/installation' },
            { text: 'Your First App', link: '/guide/your-first-app' },
            { text: 'Directory Structure', link: '/guide/directory-structure' },
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
            { text: 'Artisan Console', link: '/guide/artisan' },
          ],
        },
      ],

      '/packages/': [
        {
          text: 'Core',
          items: [
            { text: 'Package Catalog', link: '/packages/' },
            { text: '@boostkit/core', link: '/packages/core/' },
            { text: '@boostkit/contracts', link: '/packages/core/contracts' },
            { text: '@boostkit/support', link: '/packages/core/support' },
            { text: 'DI Container', link: '/packages/core/di' },
            { text: '@boostkit/middleware', link: '/packages/core/middleware' },
            { text: 'Rate Limiting & CSRF', link: '/packages/rate-limit' },
            { text: '@boostkit/validation', link: '/packages/core/validation' },
          ],
        },
        {
          text: 'Build',
          items: [
            { text: '@boostkit/vite', link: '/packages/vite/' },
          ],
        },
        {
          text: 'Server',
          items: [
            { text: '@boostkit/router', link: '/packages/server/router' },
            { text: '@boostkit/server-hono', link: '/packages/server/hono' },
          ],
        },
        {
          text: 'ORM',
          items: [
            { text: '@boostkit/orm', link: '/packages/orm/' },
            { text: '@boostkit/orm-prisma', link: '/packages/orm/prisma' },
            { text: '@boostkit/orm-drizzle', link: '/packages/orm/drizzle' },
          ],
        },
        {
          text: 'Queue',
          items: [
            { text: '@boostkit/queue', link: '/packages/queue/' },
            { text: '@boostkit/queue-bullmq', link: '/packages/queue/bullmq' },
            { text: '@boostkit/queue-inngest', link: '/packages/queue/inngest' },
          ],
        },
        {
          text: 'Auth',
          items: [
            { text: '@boostkit/auth', link: '/packages/auth/' },
            { text: 'Setup with better-auth', link: '/packages/auth/better-auth' },
          ],
        },
        {
          text: 'Session',
          items: [
            { text: '@boostkit/session', link: '/packages/session' },
          ],
        },
        {
          text: 'Cache',
          items: [
            { text: '@boostkit/cache', link: '/packages/cache/' },
            { text: 'Redis Driver', link: '/packages/cache/redis' },
          ],
        },
        {
          text: 'Storage',
          items: [
            { text: '@boostkit/storage', link: '/packages/storage/' },
            { text: 'S3 / R2 / MinIO', link: '/packages/storage/s3' },
          ],
        },
        {
          text: 'Mail',
          items: [
            { text: '@boostkit/mail', link: '/packages/mail/' },
            { text: '@boostkit/mail-nodemailer', link: '/packages/mail/nodemailer' },
          ],
        },
        {
          text: 'Features',
          items: [
            { text: '@boostkit/events', link: '/packages/events' },
            { text: '@boostkit/schedule', link: '/packages/schedule' },
            { text: '@boostkit/notification', link: '/packages/notification' },
            { text: '@boostkit/artisan', link: '/packages/artisan' },
          ],
        },
      ],

      '/cli/': [
        {
          text: 'BoostKit CLI',
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
    },

    search: {
      provider: 'local',
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/boostkitjs/boostkit' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024-present BoostKit Framework',
    },

    editLink: {
      pattern: 'https://github.com/boostkitjs/boostkit/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },

  markdown: {
    theme: { light: 'github-light', dark: 'github-dark' },
    lineNumbers: true,
  },
})
