import { Route } from '@rudderjs/router'
import { view } from '@rudderjs/view'

// One controller route → the RSC view. The controller supplies `greeting` as
// props, demonstrating that the existing view('id', props) flow composes with a
// self-fetching server component (see app/Views/Home.tsx). The view's
// `export const route = '/'` keeps the client route table in sync for SPA nav.
Route.get('/', async () => view('home', { greeting: 'Hello from a RudderJS controller' }))
