'use server'

import { rerender } from 'vike-react-rsc/server'

export interface CounterState {
  count:      number
  renderedAt: string
}

// Process-wide counter, shared across requests.
let state: CounterState = { count: 0, renderedAt: new Date().toISOString() }

// Read-only — callable from a server component (Home) directly.
export const getCount = async (): Promise<CounterState> => state

// Server action: invoked directly from the client island over RSC's RPC —
// no API route, no fetch boilerplate, no client data plumbing.
export const incrementCount = async (): Promise<CounterState> => {
  state = { count: state.count + 1, renderedAt: new Date().toISOString() }
  return state
}

// Same, but also re-renders the server tree and streams the updated UI back.
export const incrementAndRerender = async (): Promise<CounterState> => {
  state = { count: state.count + 1, renderedAt: new Date().toISOString() }
  rerender()
  return state
}
