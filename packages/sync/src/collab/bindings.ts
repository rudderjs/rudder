/**
 * Form-collab field bindings for `@rudderjs/sync`.
 *
 * A record-backed collab room ({@link createCollabRoomAuth} +
 * {@link createCollabRoomSeeder}) seeds everything into one Y.Map by default,
 * which is fine for flat scalar forms. Structured forms want more: a rich-text
 * field that merges keystroke-by-keystroke wants a `Y.Text`; a tag list wants a
 * `Y.Array`; a nested object wants its own `Y.Map`. A **field binding** maps a
 * form field name to the Y share type that backs it, plus an optional per-field
 * validator — the minimal, duck-typed contract that lets a structured form edit
 * collaboratively without the framework owning a form-schema layer.
 *
 * The contract is a plain descriptor object, the same posture as
 * {@link CollabResource} / {@link CollabSeedResource}: no `@rudderjs/orm`
 * dependency, no validation-library coupling, no form layer. The seeder
 * ({@link createCollabRoomSeeder}) reads bindings to route seed values into the
 * right share type; the React `useCollabField` hook reads them to two-way bind a
 * form input to its share with the same validation.
 *
 * Yjs is imported type-only here — every primitive operates on the live `Y.Doc`
 * methods passed in, so this module stays safe to evaluate in a client bundle.
 */

import type * as Y from 'yjs'

/** Default Y.Map name scalar fields are seeded into, matching {@link Sync.seed}. */
export const DEFAULT_FIELDS_MAP = 'fields'

/**
 * The Y share type a form field maps to:
 *
 *   - `'scalar'` — a primitive value (string / number / boolean / null) stored as
 *     one entry in the shared fields {@link DEFAULT_FIELDS_MAP | Y.Map}. The
 *     default when a field has no binding.
 *   - `'text'`   — a collaborative string backed by a dedicated `Y.Text`, keyed
 *     by the field name. Merges character-by-character; bind it through an editor
 *     (see `useCollabSeedText`), not whole-value replacement.
 *   - `'array'`  — a list backed by a dedicated `Y.Array`, keyed by the field name.
 *   - `'map'`    — a nested object backed by a dedicated `Y.Map`, keyed by the field name.
 */
export type CollabFieldType = 'scalar' | 'text' | 'array' | 'map'

/**
 * A field binding in object form. Carries the {@link CollabFieldType} and an
 * optional `validate` predicate run before a value is written — at seed time and
 * on every client edit. Returning `false` skips the write (the value is not
 * applied), so an invalid edit never reaches the CRDT.
 */
export interface CollabFieldBinding {
  type: CollabFieldType
  /**
   * Caller-supplied predicate. Return `true` to accept the value, `false` to
   * reject it. Runs both when the seeder projects a record and when a client
   * sets the field. Omit to accept every value.
   */
  validate?: (value: unknown) => boolean
}

/**
 * A form's field bindings — a field name → {@link CollabFieldType} (shorthand)
 * or {@link CollabFieldBinding} (with a validator) map. Duck-typed: a plain
 * object, no schema class. Lives on a {@link CollabSeedResource} (`fields`) so
 * one resource declares its share-type layout alongside `find` / `seed`.
 *
 * @example
 * const fields: CollabFieldBindings = {
 *   title:  'text',                                   // collaborative string
 *   tags:   'array',                                  // list
 *   meta:   'map',                                    // nested object
 *   status: { type: 'scalar', validate: (v) => v === 'draft' || v === 'published' },
 * }
 */
export type CollabFieldBindings = Record<string, CollabFieldType | CollabFieldBinding>

/**
 * Share types a {@link useCollabField} value binding can target — every collab
 * field type except `'text'`. Collaborative strings merge per-keystroke and must
 * bind through an editor adapter (`useCollabSeedText` + a Y.Text editor binding),
 * never whole-value replacement, so the value hook excludes them at the type level.
 */
export type CollabValueFieldType = Exclude<CollabFieldType, 'text'>

/** A {@link CollabFieldBinding} restricted to the value-shaped share types. */
export interface CollabValueBinding {
  type: CollabValueFieldType
  validate?: (value: unknown) => boolean
}

/** Normalize a shorthand (`'text'`) or object binding to object form. */
export function normalizeBinding(
  binding: CollabFieldType | CollabFieldBinding,
): CollabFieldBinding {
  return typeof binding === 'string' ? { type: binding } : binding
}

/** Resolve the binding for a field, defaulting to `'scalar'` when unbound. */
export function bindingFor(
  bindings: CollabFieldBindings | undefined,
  field: string,
): CollabFieldBinding {
  if (bindings && Object.prototype.hasOwnProperty.call(bindings, field)) {
    return normalizeBinding(bindings[field]!)
  }
  return { type: 'scalar' }
}

/** Run a binding's validator (if any). Absent validator → always accepts. */
function accepts(binding: CollabFieldBinding, value: unknown): boolean {
  return binding.validate ? binding.validate(value) === true : true
}

/**
 * Read a field's current value out of its bound share, projected to a plain JS
 * value: `scalar` → the map entry, `text` → the string, `array` → the JS array,
 * `map` → the plain object. Returns `undefined` when the share is unset/empty.
 */
export function readFieldValue<V = unknown>(
  doc: Y.Doc,
  field: string,
  binding: CollabFieldType | CollabFieldBinding,
  mapName: string = DEFAULT_FIELDS_MAP,
): V | undefined {
  const { type } = normalizeBinding(binding)
  switch (type) {
    case 'scalar':
      return doc.getMap(mapName).get(field) as V | undefined
    case 'text': {
      const t = doc.getText(field)
      return (t.length === 0 ? undefined : t.toString()) as V | undefined
    }
    case 'array': {
      const a = doc.getArray(field)
      return (a.length === 0 ? undefined : a.toJSON()) as V | undefined
    }
    case 'map': {
      const m = doc.getMap(field)
      return (m.size === 0 ? undefined : m.toJSON()) as V | undefined
    }
  }
}

/**
 * Replace a field's value in its bound share, inside a single transaction tagged
 * with `origin`. Validates first — a value the binding rejects is **not written**
 * and the function returns `false` (the caller can surface the rejection). Write
 * semantics are whole-value replace, so this is for value-shaped fields
 * (`scalar` / `array` / `map`); a `'text'` binding throws, since collaborative
 * strings must merge through an editor rather than be clobbered wholesale.
 *
 * @returns `true` when the value was accepted and written, `false` when the
 *          validator rejected it.
 */
export function writeFieldValue(
  doc: Y.Doc,
  field: string,
  value: unknown,
  binding: CollabFieldType | CollabFieldBinding,
  opts: { mapName?: string; origin?: unknown } = {},
): boolean {
  const norm = normalizeBinding(binding)
  if (norm.type === 'text') {
    throw new Error(
      `[RudderJS sync] writeFieldValue cannot replace the 'text' field "${field}" — ` +
        `collaborative strings merge per-keystroke and must bind through an editor (useCollabSeedText).`,
    )
  }
  if (!accepts(norm, value)) return false

  const mapName = opts.mapName ?? DEFAULT_FIELDS_MAP
  doc.transact(() => {
    switch (norm.type) {
      case 'scalar':
        doc.getMap(mapName).set(field, value ?? null)
        break
      case 'array': {
        const a = doc.getArray(field)
        if (a.length > 0) a.delete(0, a.length)
        if (Array.isArray(value) && value.length > 0) a.push(value as unknown[])
        break
      }
      case 'map': {
        const m = doc.getMap(field)
        m.clear()
        if (value && typeof value === 'object') {
          for (const [k, v] of Object.entries(value as Record<string, unknown>)) m.set(k, v)
        }
        break
      }
    }
  }, opts.origin)
  return true
}

/**
 * Subscribe to changes on a field's bound share. Invokes `cb` with the freshly
 * read value on every observed change. Returns an unsubscribe function.
 *
 * `scalar` fields share one Y.Map, so the callback only fires when *this* field's
 * key changes (other scalar fields mutating the same map are filtered out);
 * `array` / `map` / `text` observe their own dedicated share deeply.
 */
export function observeFieldValue<V = unknown>(
  doc: Y.Doc,
  field: string,
  binding: CollabValueFieldType | CollabValueBinding,
  cb: (value: V | undefined) => void,
  mapName: string = DEFAULT_FIELDS_MAP,
): () => void {
  const { type } = normalizeBinding(binding)
  const emit = () => cb(readFieldValue<V>(doc, field, binding, mapName))

  if (type === 'scalar') {
    const map = doc.getMap(mapName)
    const handler = (e: Y.YMapEvent<unknown>) => {
      if (e.keysChanged.has(field)) emit()
    }
    map.observe(handler)
    return () => map.unobserve(handler)
  }

  const share = type === 'array' ? doc.getArray(field) : doc.getMap(field)
  share.observeDeep(emit)
  return () => share.unobserveDeep(emit)
}

/**
 * Seed a record's projected data into a Y.Doc, routing each field into the share
 * its binding names. Scalar fields seed as a group into the shared
 * {@link DEFAULT_FIELDS_MAP | fields map}, gated on that map still being empty;
 * `text` / `array` / `map` fields each seed into their own share, gated on that
 * share being empty. Everything happens in a single transaction tagged `origin`,
 * so a doc already hydrated from persistence (or seeded by a racing connection)
 * is left untouched and the whole seed is one atomic, filterable update.
 *
 * A field whose binding validator rejects its seed value is skipped (fail-soft) —
 * the same posture the seeder takes for a missing record.
 */
export function seedBoundFields(
  doc: Y.Doc,
  data: Record<string, unknown>,
  opts: { bindings?: CollabFieldBindings | undefined; mapName?: string; origin?: unknown } = {},
): void {
  const mapName = opts.mapName ?? DEFAULT_FIELDS_MAP
  const entries = Object.entries(data ?? {})
  if (entries.length === 0) return

  doc.transact(() => {
    const fields = doc.getMap(mapName)
    const scalarEmpty = fields.size === 0

    for (const [key, value] of entries) {
      const binding = bindingFor(opts.bindings, key)
      if (!accepts(binding, value)) continue

      switch (binding.type) {
        case 'scalar':
          // Scalar fields seed atomically as a group: only when the shared map is
          // still empty, matching the pre-bindings whole-map idempotence gate.
          if (scalarEmpty) fields.set(key, value ?? null)
          break
        case 'text': {
          const t = doc.getText(key)
          if (t.length === 0 && typeof value === 'string') t.insert(0, value)
          break
        }
        case 'array': {
          const a = doc.getArray(key)
          if (a.length === 0 && Array.isArray(value)) a.push(value as unknown[])
          break
        }
        case 'map': {
          const m = doc.getMap(key)
          if (m.size === 0 && value && typeof value === 'object') {
            for (const [k, v] of Object.entries(value as Record<string, unknown>)) m.set(k, v)
          }
          break
        }
      }
    }
  }, opts.origin)
}
