import type { Column } from './EntryList.js'

/**
 * Per-watcher column configurations for the generic `EntryList` template.
 *
 * Each entry maps a watcher type to its display config. The map key is
 * the entry type as it appears in the URL (e.g. `requests`, `queries`),
 * NOT the singular `EntryType` from `../../src/types.ts`.
 *
 * To add a new column for an existing watcher: edit the array below.
 * To add a new watcher: add a key here AND register the route in
 * `../../src/routes.ts`.
 */
export interface PageConfig {
  /** Singular type name passed to EntryList — backend uses pluralisation rules */
  type:    string
  title:   string
  columns: Column[]
}

export const pages: Record<string, PageConfig> = {
  requests: {
    type:  'request',
    title: 'Requests',
    columns: [
      { label: 'Method',   key: 'entry.content.method', badge: true },
      { label: 'Path',     key: 'entry.content.path',   mono: true },
      { label: 'Duration', key: 'entry.content.duration + "ms"', className: 'text-right' },
    ],
  },

  queries: {
    type:  'query',
    title: 'Queries',
    columns: [
      { label: 'SQL',      key: 'entry.content.sql',      mono: true, className: 'truncate max-w-md' },
      { label: 'Duration', key: 'entry.content.duration + "ms"', className: 'text-right' },
      { label: 'Model',    key: 'entry.content.model || "—"' },
    ],
  },

  jobs: {
    type:  'job',
    title: 'Jobs',
    columns: [
      { label: 'Class',    key: 'entry.content.class',  mono: true },
      { label: 'Queue',    key: 'entry.content.queue' },
      { label: 'Status',   key: 'entry.content.status', badge: true },
      { label: 'Duration', key: '(entry.content.duration || 0) + "ms"', className: 'text-right' },
    ],
  },

  exceptions: {
    type:  'exception',
    title: 'Exceptions',
    columns: [
      { label: 'Class',   key: 'entry.content.class',   mono: true, className: 'text-red-600' },
      { label: 'Message', key: 'entry.content.message',  className: 'truncate max-w-md' },
    ],
  },

  logs: {
    type:  'log',
    title: 'Logs',
    columns: [
      { label: 'Level',   key: 'entry.content.level',   badge: true },
      { label: 'Channel', key: 'entry.content.channel' },
      { label: 'Message', key: 'entry.content.message',  className: 'truncate max-w-lg' },
    ],
  },

  mail: {
    type:  'mail',
    title: 'Mail',
    columns: [
      { label: 'Class',   key: 'entry.content.class',   mono: true },
      { label: 'Subject', key: 'entry.content.subject',  className: 'truncate max-w-md' },
      { label: 'To',      key: 'Array.isArray(entry.content.to) ? entry.content.to.join(", ") : entry.content.to' },
    ],
  },

  notifications: {
    type:  'notification',
    title: 'Notifications',
    columns: [
      { label: 'Class',      key: 'entry.content.class',   mono: true },
      { label: 'Channel',    key: 'entry.content.channel' },
      { label: 'Notifiable', key: 'entry.content.notifiable' },
    ],
  },

  events: {
    type:  'event',
    title: 'Events',
    columns: [
      { label: 'Name', key: 'entry.content.name', mono: true },
    ],
  },

  cache: {
    type:  'cache',
    title: 'Cache',
    columns: [
      { label: 'Key',       key: 'entry.content.key || "—"', mono: true, className: 'truncate max-w-md' },
      { label: 'Operation', key: 'entry.content.operation', badge: true },
    ],
  },

  schedule: {
    type:  'schedule',
    title: 'Scheduled Tasks',
    columns: [
      { label: 'Description', key: 'entry.content.description' },
      { label: 'Expression',  key: 'entry.content.expression', mono: true },
      { label: 'Status',      key: 'entry.content.status', badge: true },
      { label: 'Duration',    key: '(entry.content.duration || 0) + "ms"', className: 'text-right' },
    ],
  },

  models: {
    type:  'model',
    title: 'Model Changes',
    columns: [
      { label: 'Model',  key: 'entry.content.model',  mono: true },
      { label: 'Action', key: 'entry.content.action', badge: true },
    ],
  },

  commands: {
    type:  'command',
    title: 'Commands',
    columns: [
      { label: 'Name',     key: 'entry.content.name',                    mono: true },
      { label: 'Source',   key: 'entry.content.source',                  badge: true },
      { label: 'Exit',     key: 'entry.content.exitCode',                className: 'text-right font-mono text-xs' },
      { label: 'Duration', key: '(entry.content.duration || 0) + "ms"', className: 'text-right' },
    ],
  },

  http: {
    type:  'http',
    title: 'HTTP Client',
    columns: [
      { label: 'Method',   key: 'entry.content.method',                      badge: true },
      { label: 'URL',      key: 'entry.content.url',                         mono: true, className: 'truncate max-w-md' },
      { label: 'Status',   key: 'entry.content.status || "ERR"',            badge: true },
      { label: 'Duration', key: '(entry.content.duration || 0) + "ms"',     className: 'text-right' },
    ],
  },

  gates: {
    type:  'gate',
    title: 'Gates',
    columns: [
      { label: 'Ability',  key: 'entry.content.ability',                              mono: true },
      { label: 'Result',   key: 'entry.content.allowed ? "Allowed" : "Denied"',      badge: true },
      { label: 'Via',      key: 'entry.content.resolvedVia',                          badge: true },
      { label: 'Duration', key: '(entry.content.duration || 0) + "ms"',              className: 'text-right' },
    ],
  },

  dumps: {
    type:  'dump',
    title: 'Dumps',
    columns: [
      { label: 'Method', key: 'entry.content.method',                badge: true },
      { label: 'Args',   key: 'entry.content.count + " value(s)"' },
      { label: 'Caller', key: 'entry.content.caller || "—"',        mono: true, className: 'truncate max-w-md text-xs' },
    ],
  },

  broadcasts: {
    type:  'broadcast',
    title: 'WebSockets',
    columns: [
      { label: 'Kind',    key: 'entry.content.kind',                                       badge: true },
      { label: 'Channel', key: 'entry.content.channel || "—"',                             mono: true, className: 'truncate max-w-md' },
      { label: 'Event',   key: 'entry.content.event || "—"' },
      { label: 'Conn',    key: '(entry.content.connectionId || "").slice(0, 8) || "—"',   mono: true, className: 'text-xs' },
    ],
  },

  live: {
    type:  'live',
    title: 'Live (Yjs)',
    columns: [
      { label: 'Kind',     key: 'entry.content.kind',                                      badge: true },
      { label: 'Doc',      key: 'entry.content.docName || "—"',                            mono: true, className: 'truncate max-w-xs' },
      { label: 'Client',   key: '(entry.content.clientId || "").slice(0, 8) || "—"',     mono: true, className: 'text-xs' },
      { label: 'Bytes',    key: 'entry.content.byteSize != null ? entry.content.byteSize : "—"', className: 'text-right font-mono text-xs' },
    ],
  },
}
