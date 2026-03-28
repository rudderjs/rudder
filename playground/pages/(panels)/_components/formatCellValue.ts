import type { PanelColumnMeta, PanelI18n } from '@boostkit/panels'

export function formatCellValue(value: unknown, col: PanelColumnMeta | null, i18n: PanelI18n, _panelPath?: string): string {
  if (value === null || value === undefined) return '\u2014'
  if (col?.type === 'boolean' || typeof value === 'boolean') return value ? i18n.yes : i18n.no
  if (col?.type === 'date' || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) || value instanceof Date) {
    try {
      return new Intl.DateTimeFormat('en', { dateStyle: col?.format === 'datetime' ? undefined : 'medium', ...(col?.format === 'datetime' ? { dateStyle: 'medium', timeStyle: 'short' } : {}) }).format(new Date(String(value)))
    } catch { return String(value) }
  }
  return String(value)
}
