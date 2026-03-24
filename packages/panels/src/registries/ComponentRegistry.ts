import type { ComponentType } from 'react'
import { createMapRegistry } from './BaseRegistry.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fields   = createMapRegistry<ComponentType<any>>('fields')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const elements = createMapRegistry<ComponentType<any>>('elements')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LazyFactory = () => Promise<{ default: ComponentType<any> }>
const lazyFactories = createMapRegistry<LazyFactory>('lazy_elements')

/** Register a custom field input component. */
export const registerField = fields.register
/** Look up a registered field component by key. @internal */
export const getField      = fields.get

/** Register a custom schema element renderer. */
export const registerElement = elements.register
/** Look up a registered element component by type. @internal */
export const getElement      = elements.get
/** Subscribe to element registration changes. @internal */

/**
 * Register a lazy-loaded schema element.
 * The factory returns a dynamic import with a default export.
 * SchemaElementRenderer wraps it with React.lazy + Suspense.
 */
export const registerLazyElement = lazyFactories.register
/** Look up a lazy element factory by type. @internal */
export const getLazyElement = lazyFactories.get
