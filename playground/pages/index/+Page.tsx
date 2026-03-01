import { useData } from 'vike-react/useData'
import { Button } from '@/components/ui/button'
import type { Data } from './+data.js'

export default function Page() {
  const data = useData<Data>()
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-bold tracking-tight">{data.title}</h1>
      <p className="text-muted-foreground">{data.message}</p>
      <div className="flex gap-2">
        <Button>Get Started</Button>
        <Button variant="outline">Learn More</Button>
      </div>
    </div>
  )
}
