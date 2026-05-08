import { type TemplateContext } from '../../templates.js'

export function routesConsole(ctx: TemplateContext): string {
  return [
    `import { rudder } from '@rudderjs/console'`,
    ...(ctx.packages.terminal ? [`import { terminal } from '@rudderjs/terminal'`] : []),
    ``,
    `rudder.command('inspire', () => {`,
    `  const quotes = [`,
    `    'The best way to predict the future is to create it.',`,
    `    'Build something people want.',`,
    `    'Stay hungry, stay foolish.',`,
    `    'Code is poetry.',`,
    `    'Simplicity is the soul of efficiency.',`,
    `  ]`,
    `  const quote = quotes[Math.floor(Math.random() * quotes.length)]!`,
    `  console.log(\`\\n  "\${quote}"\\n\`)`,
    `}).description('Display an inspiring quote')`,
    ``,
    `rudder.command('db:seed', async () => {`,
    `  // TODO: add your seed data here`,
    `  console.log('No seed data configured. Edit routes/console.ts to add seed logic.')`,
    `}).description('Seed the database with sample data')`,
    ...(ctx.packages.terminal ? [
      ``,
      `rudder.command('dashboard', async () => {`,
      `  await terminal('dashboard')`,
      `}).description('Render the Dashboard view in the terminal')`,
    ] : []),
  ].join('\n') + '\n'
}
