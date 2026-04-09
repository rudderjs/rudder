import type { MediaPluginConfig } from '@pilotiq/media/server'

export default {
  libraries: {
    photos: {
      disk: 'public',
      directory: 'photos',
      accept: ['image/*'],
      conversions: [
        { name: 'thumb', width: 200, height: 200, crop: true, format: 'webp' },
        { name: 'preview', width: 800, format: 'webp' },
      ],
    },
    documents: {
      disk: 'public',
      directory: 'docs',
      accept: ['application/pdf', 'text/*'],
    },
  },
} satisfies MediaPluginConfig
