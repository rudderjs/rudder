/**
 * True for Vite internals, source files, and static assets that should be excluded
 * from request metrics. Used by request and user aggregators.
 */
export function isAsset(path: string): boolean {
  if (path.startsWith('/@'))            return true  // Vite internals: /@vite, /@react-refresh, /@id, /@fs
  if (path.startsWith('/node_modules')) return true
  if (path.startsWith('/src/'))         return true  // Vite source modules during dev
  if (path.startsWith('/pages/'))       return true  // Vike page modules during dev
  if (path.startsWith('/.vite/'))       return true  // Vite cache
  const segment = path.split('/').pop() ?? ''
  return segment.includes('.')                       // any file extension → static asset
}
