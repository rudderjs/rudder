import '@/index.css'
import { useData } from 'vike-react/useData'
import type { Data } from './+data.js'

export default function Page() {
  const data = useData<Data>()
  return (
    <div>
      <h1>Users</h1>
      <ul>
        {data.users.map((user) => (
          <li key={user.id}>{user.name}</li>
        ))}
      </ul>
    </div>
  )
}
