'use client'

import { useState, useTransition } from 'react'
import { incrementCount } from 'App/Actions/counter.ts'

// Client component ("use client") — the only part of this page that ships JS.
// It calls the "use server" action directly; vike-react-rsc-rudder handles the
// RPC round-trip and serializes the result.
export default function CounterClient({ initialCount }: { initialCount: number }) {
  const [count, setCount]         = useState(initialCount)
  const [isPending, startTransition] = useTransition()

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <p>
        Count: <strong>{count}</strong>
        {isPending ? ' …' : ''}
      </p>
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const next = await incrementCount()
            setCount(next.count)
          })
        }
      >
        Increment (server action)
      </button>
    </div>
  )
}
