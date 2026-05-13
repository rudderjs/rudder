/**
 * Shared formatting helpers used across per-watcher detail views.
 *
 * Kept package-internal — none of these are re-exported from the package
 * entry. They're tiny, side-effect free, and only meaningful within the
 * dashboard rendering pipeline.
 */

/** HTML-escape a value for use inside raw template strings. */
export function escape(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Format a Date (or ISO string) using the browser's locale. */
export function formatTimestamp(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d)
  return date.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

/** Format a byte count with the smallest unit that keeps the magnitude ≥ 1. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Tailwind class string for an HTTP status badge — colored by status range. */
export function statusColor(status: number): string {
  if (status >= 500) return 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
  if (status >= 400) return 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'
  if (status >= 300) return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
  if (status >= 200) return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
  return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
}
