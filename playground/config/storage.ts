import path from 'node:path'
import { Env } from '@forge/support'
import type { StorageConfig } from '@forge/storage'

export default {
  default: Env.get('FILESYSTEM_DISK', 'local'),

  disks: {
    local: {
      driver:  'local',
      root:    path.resolve(process.cwd(), 'storage/app'),
      baseUrl: '/api/files',
    },

    public: {
      driver:  'local',
      root:    path.resolve(process.cwd(), 'storage/app/public'),
      baseUrl: Env.get('APP_URL', 'http://localhost:3000') + '/storage',
    },

    s3: {
      driver:          's3',
      bucket:          Env.get('AWS_BUCKET', ''),
      region:          Env.get('AWS_DEFAULT_REGION', 'us-east-1'),
      accessKeyId:     Env.get('AWS_ACCESS_KEY_ID', ''),
      secretAccessKey: Env.get('AWS_SECRET_ACCESS_KEY', ''),
      endpoint:        Env.get('AWS_ENDPOINT', ''),
      baseUrl:         Env.get('AWS_URL', ''),
    },
  },
} satisfies StorageConfig
