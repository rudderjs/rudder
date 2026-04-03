# Media Library

Full-featured media library for `@rudderjs/panels` -- file browser, uploads, image conversions, and preview.

## Installation

```bash
pnpm add @rudderjs/media sharp
```

## Setup

Register as a panels extension in your providers:

```ts
// bootstrap/providers.ts
import { panels } from '@rudderjs/panels'
import { media } from '@rudderjs/media'

export default [
  panels([AdminPanel], [
    media({
      conversions: [
        { name: 'thumb', width: 200, height: 200, crop: true, format: 'webp' },
        { name: 'preview', width: 800, format: 'webp' },
      ],
    }),
  ]),
]
```

Publish the Prisma schema shard and panel pages, then sync your database:

```bash
pnpm rudder vendor:publish --tag=media-schema
pnpm rudder vendor:publish --tag=media-pages
pnpm exec prisma db push
```

## Features

- **File browser** -- grid and list views, folder navigation
- **Upload** -- multi-file, drag-and-drop, directory drop, URL drop from browser
- **Preview panel** -- images, video, audio, PDF, text, CSV, JSON
- **Folders** -- create, rename, move files between folders
- **Scope** -- shared or private per user
- **Image conversions** -- automatic thumbnail/preview generation via `@rudderjs/image`

## Configuration

| Option | Type | Description |
|---|---|---|
| `disk` | `string` | Storage disk name (default: `'public'`) |
| `directory` | `string` | Base directory for uploads |
| `maxUploadSize` | `number` | Max file size in bytes |
| `conversions` | `ConversionSpec[]` | Image conversion definitions |
| `acceptedMimes` | `string[]` | Allowed MIME types |

## Database Model

The `Media` model stores file metadata:

| Column | Type | Description |
|---|---|---|
| `id` | `string` | Primary key |
| `name` | `string` | Display name |
| `type` | `'file' \| 'folder'` | Entry type |
| `mime` | `string?` | MIME type |
| `size` | `number?` | File size in bytes |
| `disk` | `string` | Storage disk |
| `directory` | `string` | Storage directory |
| `filename` | `string?` | Stored filename |
| `width` | `number?` | Image width |
| `height` | `number?` | Image height |
| `focalX` | `number?` | Focal point X (0--1) |
| `focalY` | `number?` | Focal point Y (0--1) |
| `conversions` | `JSON?` | Generated conversion results |
| `alt` | `string?` | Alt text |
| `meta` | `JSON?` | Arbitrary metadata |
| `parentId` | `string?` | Parent folder ID |
| `scope` | `string?` | Scope (shared/user ID) |
| `userId` | `string?` | Owner user ID |

## API Routes

The media extension auto-mounts these routes under the panel prefix:

| Method | Path | Description |
|---|---|---|
| `GET` | `/{panel}/api/media` | List files and folders |
| `GET` | `/{panel}/api/media/:id` | Get single media item |
| `POST` | `/{panel}/api/media/folder` | Create a folder |
| `POST` | `/{panel}/api/media/upload` | Upload files |
| `PATCH` | `/{panel}/api/media/:id` | Update metadata (rename, alt, focal point) |
| `DELETE` | `/{panel}/api/media/:id` | Delete file or folder |
| `POST` | `/{panel}/api/media/:id/move` | Move to another folder |
| `GET` | `/{panel}/api/media/:id/url` | Get public URL |
