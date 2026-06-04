import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Rudder',
  description: 'Laravel-inspired Node.js full-stack framework built on Vike + Vite',
  lang: 'en-US',
  ignoreDeadLinks: 'localhostLinks',

  // `docs/plans/` holds internal RFC/investigation artifacts, not user docs.
  // They're not in the nav or sidebar and use technical prose (`Promise<T>`,
  // `<2% CPU`, etc.) that VitePress's Vue-template parser rejects. Exclude
  // them from the build to keep the published site focused on guide + packages.
  srcExclude: ['plans/**'],

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['meta', { name: 'theme-color', content: '#f97316' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'Rudder',

    nav: [
      { text: 'Guide', link: '/guide/', activeMatch: '/guide/' },
      { text: 'Packages', link: '/packages/', activeMatch: '/packages/' },
      { text: 'Contributing', link: '/contributing/', activeMatch: '/contributing/' },
      {
        text: 'v1.0',
        items: [
          { text: 'Changelog', link: 'https://github.com/rudderjs/rudder/releases' },
          { text: 'Contributing Guide', link: '/contributing/' },
        ],
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Prologue',
          items: [
            { text: 'Release Notes', link: 'https://github.com/rudderjs/rudder/releases' },
            { text: 'Quality', link: '/guide/quality' },
            { text: 'Contributing', link: '/contributing/' },
          ],
        },
        {
          text: 'Getting Started',
          items: [
            { text: 'What is Rudder?', link: '/guide/' },
            { text: 'When Not to Use Rudder', link: '/guide/when-not-to-use' },
            { text: 'Installation', link: '/guide/installation' },
            { text: 'Your First App', link: '/guide/tutorial' },
            { text: 'Configuration', link: '/guide/configuration' },
            { text: 'Directory Structure', link: '/guide/directory-structure' },
            { text: 'Frontend', link: '/guide/frontend' },
            { text: 'Typed Views', link: '/guide/typed-views' },
            { text: 'Typed Routes', link: '/guide/typed-routes' },
            { text: 'Prerendering', link: '/guide/prerender' },
            { text: 'Deployment', link: '/guide/deployment' },
          ],
        },
        {
          text: 'Architecture Concepts',
          items: [
            { text: 'Application',       link: '/guide/application' },
            { text: 'Request Lifecycle', link: '/guide/lifecycle' },
            { text: 'Service Container', link: '/guide/container' },
            { text: 'Service Providers', link: '/guide/service-providers' },
            { text: 'Facades',           link: '/guide/facades' },
          ],
        },
        {
          text: 'The Basics',
          items: [
            { text: 'Routing', link: '/guide/routing' },
            { text: 'Middleware', link: '/guide/middleware' },
            { text: 'Controllers', link: '/guide/controllers' },
            { text: 'Requests', link: '/guide/requests' },
            { text: 'Responses', link: '/guide/responses' },
            { text: 'Validation', link: '/guide/validation' },
            { text: 'Error Handling', link: '/guide/error-handling' },
            { text: 'Logging', link: '/guide/logging' },
          ],
        },
        {
          text: 'Digging Deeper',
          items: [
            { text: 'Rudder Console', link: '/guide/rudder' },
            { text: 'Rudder Doctor', link: '/guide/doctor' },
            { text: 'Tinker', link: '/guide/tinker' },
            { text: 'Broadcasting', link: '/guide/broadcasting' },
            { text: 'Cache', link: '/guide/cache' },
            { text: 'Contracts', link: '/guide/contracts' },
            { text: 'Events', link: '/guide/events' },
            { text: 'File Storage', link: '/guide/storage' },
            { text: 'HTTP Client', link: '/guide/http-client' },
            { text: 'Localization', link: '/guide/localization' },
            { text: 'Mail', link: '/guide/mail' },
            { text: 'Notifications', link: '/guide/notifications' },
            { text: 'Queues', link: '/guide/queues' },
            { text: 'Rate Limiting', link: '/guide/rate-limiting' },
            { text: 'Sync', link: '/guide/sync' },
            { text: 'Task Scheduling', link: '/guide/scheduling' },
          ],
        },
        {
          text: 'Security',
          items: [
            { text: 'Authentication', link: '/guide/authentication' },
            { text: 'Authorization', link: '/guide/authorization' },
            { text: 'Encryption', link: '/guide/encryption' },
            { text: 'Hashing', link: '/guide/hashing' },
          ],
        },
        {
          text: 'Database',
          items: [
            { text: 'Getting Started', link: '/guide/database' },
            { text: 'Models', link: '/guide/database/models' },
            { text: 'Query Builder', link: '/guide/database/query-builder' },
            { text: 'API Resources', link: '/guide/database/resources' },
            { text: 'Connections', link: '/guide/database/connections' },
            { text: 'Migrations', link: '/guide/database/migrations' },
            { text: 'Native Engine', link: '/guide/database/native' },
            { text: 'Prisma Adapter', link: '/guide/database/prisma' },
            { text: 'Drizzle Adapter', link: '/guide/database/drizzle' },
          ],
        },
        {
          text: 'AI',
          items: [
            { text: 'AI',             link: '/guide/ai' },
            { text: 'Vector Stores',  link: '/guide/vector-stores' },
            { text: 'Computer-use',   link: '/guide/computer-use' },
            { text: 'Boost',          link: '/packages/boost' },
          ],
        },
        {
          text: 'Model Context Protocol',
          items: [
            { text: 'MCP', link: '/guide/mcp' },
          ],
        },
        {
          text: 'Testing',
          items: [
            { text: 'Getting Started', link: '/guide/testing' },
          ],
        },
      ],

      '/packages/': [
        {
          text: 'Packages',
          items: [
            { text: 'Overview', link: '/packages/' },
            { text: 'Boost', link: '/packages/boost' },
            { text: 'Cashier Paddle', link: '/packages/cashier-paddle' },
            { text: 'Horizon', link: '/packages/horizon' },
            { text: 'Passport', link: '/packages/passport' },
            { text: 'Pennant', link: '/packages/pennant' },
            { text: 'Pulse', link: '/packages/pulse' },
            { text: 'Sanctum', link: '/packages/sanctum' },
            { text: 'Socialite', link: '/packages/socialite' },
            { text: 'Telescope', link: '/packages/telescope' },
          ],
        },
      ],

      '/contributing/': [
        {
          text: 'Contributing',
          items: [
            { text: 'Overview', link: '/contributing/' },
            { text: 'Creating a New Package', link: '/contributing/new-package' },
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
