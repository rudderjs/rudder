// `cashier:install` — print the steps to publish schema + views into the app.
//
// `vendor:publish` is exposed only as a CLI command in `@rudderjs/cli` (no
// programmatic export), so this command just prints the canonical sequence
// for the user to run. Keeps cashier-paddle free of a console/cli runtime dep.

export async function runInstall(): Promise<void> {
  console.log('  Run these commands to install cashier-paddle:')
  console.log('    pnpm rudder vendor:publish --tag=cashier-schema')
  console.log('    pnpm rudder vendor:publish --tag=cashier-views-react')
  console.log('')
  console.log('  Prisma apps then:')
  console.log('    pnpm exec prisma generate')
  console.log('    pnpm exec prisma db push')
  console.log('  Native-engine apps then:')
  console.log('    pnpm rudder migrate')
  console.log('')
  console.log('  Then:')
  console.log('    1. Add `Billable` to your User model: `class User extends Billable(Model) {}`')
  console.log('    2. Set PADDLE_API_KEY, PADDLE_CLIENT_SIDE_TOKEN, PADDLE_WEBHOOK_SECRET in .env')
  console.log('    3. Mount the webhook: `registerCashierRoutes(Route)` in routes/web.ts')
}
