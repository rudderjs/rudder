import { Page, Heading, Text, Table, Column } from '@pilotiq/panels'
import type { PanelContext } from '@pilotiq/panels'

export class ExternalDataDemo extends Page {
  static slug  = 'external-data'
  static label = 'External Data'
  static icon  = 'globe'

  static async schema(_ctx: PanelContext) {
    return [
      Heading.make('External API Tables'),
      Text.make('Data fetched from external APIs via .fromArray(async fn).'),

      Heading.make('SSR API Data').level(2),
      Text.make('Fetched at SSR time — data is in the HTML on first render.'),

      Table.make('GitHub-style Users')
        .fromArray(async () => {
          const res = await fetch('https://jsonplaceholder.typicode.com/users')
          const users = await res.json() as Array<{ id: number; name: string; email: string; company: { name: string }; address: { city: string } }>
          return users.map(u => ({
            id: u.id,
            name: u.name,
            email: u.email,
            company: u.company.name,
            city: u.address.city,
          }))
        })
        .columns([
          Column.make('name').label('Name').sortable().searchable(),
          Column.make('email').label('Email').sortable().searchable(),
          Column.make('company').label('Company').sortable(),
          Column.make('city').label('City').sortable(),
        ])
        .searchable()
        .description('10 users from jsonplaceholder.typicode.com'),

      Heading.make('Lazy API Data').level(2),
      Text.make('Shows skeleton on SSR, fetches client-side after mount.'),

      Table.make('Posts (Lazy)')
        .fromArray(async () => {
          const res = await fetch('https://jsonplaceholder.typicode.com/posts')
          const posts = await res.json() as Array<{ id: number; title: string; userId: number }>
          return posts.slice(0, 20).map(p => ({
            id: p.id,
            title: p.title,
            author: `User ${p.userId}`,
          }))
        })
        .columns([
          Column.make('title').label('Title').sortable().searchable(),
          Column.make('author').label('Author').sortable(),
        ])
        .paginated('pages', 5)
        .searchable()
        .lazy()
        .description('20 posts — lazy loaded'),
    ]
  }
}
