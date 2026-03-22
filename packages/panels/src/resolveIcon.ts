// ─── Icon resolver (no-op) ──────────────────────────────────
// Icons are resolved client-side via ResourceIcon component.
// Users can pass inline SVG via .icon('<svg ...>') for instant SSR rendering.

/** @internal */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveIcons(_meta: any): Promise<void> {}

/** @internal */
export async function resolveIcon(icon: string | undefined): Promise<string | undefined> {
  return icon
}
