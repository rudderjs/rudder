# @boostkit/storage-s3

S3-compatible storage adapter provider for `@boostkit/storage`.

## Installation

```bash
pnpm add @boostkit/storage-s3
```

## Usage

```ts
import { s3 } from '@boostkit/storage-s3'

const provider = s3({
  driver: 's3',
  bucket: 'my-bucket',
  region: 'us-east-1',
  endpoint: 'https://s3.amazonaws.com',
  forcePathStyle: false,
})

const adapter = provider.create()
```

## API Reference

- `S3DiskConfig`
- `s3(config)` → `StorageAdapterProvider`

## Configuration

- `S3DiskConfig`
  - `driver`
  - `bucket`
  - `region?`, `endpoint?`
  - `accessKeyId?`, `secretAccessKey?`
  - `baseUrl?`
  - `forcePathStyle?`

## Notes

- Uses `@aws-sdk/client-s3`.
- Works with AWS S3 and compatible endpoints.
