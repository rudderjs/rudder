import { useData } from 'vike-react/useData'
import type { Data } from './+data.js'

export default function Page() {
  const data = useData<Data>()
  return (
    <div>
      <h1>{data.title}</h1>
      <p>{data.message}</p>
    </div>
  )
}
