// Boot status singleton — set by the doctor command's --deep path, read by
// runtime checks. Lives on globalThis so per-package checks (which import
// from @rudderjs/cli's dist subpath) see the same value.

export interface BootStatus {
  ok:    boolean
  error?: string
  /** Wall-clock ms the bootApp() call took (success or failure). */
  durationMs: number
}

const KEY = '__rudderjs_doctor_boot_status__'

export function setBootStatus(status: BootStatus): void {
  ;(globalThis as Record<string, unknown>)[KEY] = status
}

export function getBootStatus(): BootStatus | null {
  return (globalThis as Record<string, unknown>)[KEY] as BootStatus | null
}

export function clearBootStatus(): void {
  delete (globalThis as Record<string, unknown>)[KEY]
}
