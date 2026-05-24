export const route = '/'

import CounterClient from 'App/Components/CounterClient.tsx'
import { getCount } from 'App/Actions/counter.ts'

export interface Props {
  greeting: string
}

// React Server Component: runs only on the server and ships zero client JS for
// its own markup. It receives controller props (the RudderJS `view('home', props)`
// flow — the generated +Page stub spreads `viewProps` in) AND fetches its own
// data, so the two models compose. Interactivity is opt-in via the
// <CounterClient> island below.
export default async function Home({ greeting }: Props) {
  const { count, renderedAt } = await getCount()

  return (
    <div>
      <h1>RudderJS &times; React Server Components</h1>
      <p>{greeting}</p>
      <p>
        Server-rendered at <code>{renderedAt}</code> — this paragraph ships no
        client JavaScript.
      </p>
      <CounterClient initialCount={count} />
    </div>
  )
}
