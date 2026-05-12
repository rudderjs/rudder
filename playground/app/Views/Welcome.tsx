import '@/index.css'
import { SiteHeader } from 'App/Components/SiteHeader.js'

// URL this view is served at — MUST match the controller in routes/web.ts.
// The scanner reads this constant and writes it into the generated +route.ts,
// so Vike's client router can SPA-navigate here instead of doing full reloads.
export const route = '/'

export interface WelcomeProps {
  appName:       string
  rudderVersion: string
  nodeVersion:   string
  env:           string
}

export default function Welcome(props: WelcomeProps) {
  return (
    <div className="page page-flex">
      <SiteHeader />

      <main className="page-main-centered">
        <section className="hero">
          <h1 className="hero-title">{props.appName}</h1>
          <p className="hero-lead">
            Laravel&apos;s developer experience, Vike&apos;s performance, Node&apos;s ecosystem.
          </p>
          <div className="hero-meta">
            <span>RudderJS v{props.rudderVersion}</span>
            <span>•</span>
            <span>Node {props.nodeVersion}</span>
            <span>•</span>
            <span>env={props.env}</span>
          </div>
        </section>
      </main>
    </div>
  )
}
