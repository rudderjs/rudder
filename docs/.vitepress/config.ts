import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'RudderJS',
  description: 'Laravel-inspired Node.js full-stack framework built on Vike + Vite',
  lang: 'en-US',
  ignoreDeadLinks: 'localhostLinks',

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
            { text: 'Contributing', link: '/contributing/' },
          ],
        },
        {
          text: 'Getting Started',
          items: [
            { text: 'What is RudderJS?', link: '/guide/' },
            { text: 'Installation', link: '/guide/installation' },
            { text: 'Configuration', link: '/guide/configuration' },
            { text: 'Directory Structure', link: '/guide/directory-structure' },
            { text: 'Frontend', link: '/guide/frontend' },
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
            { text: 'Migrations', link: '/guide/database/migrations' },
            { text: 'Prisma Adapter', link: '/guide/database/prisma' },
            { text: 'Drizzle Adapter', link: '/guide/database/drizzle' },
          ],
        },
        {
          text: 'AI',
          items: [
            { text: 'AI',             link: '/guide/ai' },
            { text: 'Vector Stores',  link: '/guide/vector-stores' },
            { text: 'MCP',            link: '/guide/mcp' },
            { text: 'Boost',          link: '/packages/boost' },
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
