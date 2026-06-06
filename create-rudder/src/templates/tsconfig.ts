import type { TemplateContext } from '../templates.js'

export function tsconfigJson(ctx: TemplateContext): string {
  const hasReact = ctx.frameworks.includes('react')
  const hasSolid = ctx.frameworks.includes('solid')

  const compilerOptions: Record<string, unknown> = {
    target:                     'ES2022',
    module:                     'ESNext',
    moduleResolution:           'bundler',
    lib:                        ['ES2022', 'DOM', 'DOM.Iterable'],
    strict:                     true,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess:   true,
    experimentalDecorators:     true,
    emitDecoratorMetadata:      true,
    skipLibCheck:               true,
    noEmit:                     true,
    // `types` replaces automatic @types inclusion: 'node' keeps the global
    // `process` used by config/, 'vite/client' types `import.meta.env` so
    // app code touching it passes `tsc --noEmit` out of the box.
    types:                      ['node', 'vite/client'],
    baseUrl:                    '.',
    paths:                      { '@/*': ['./src/*'], 'App/*': ['./app/*'] },
    allowImportingTsExtensions: true,
  }

  if (hasReact) {
    compilerOptions['jsx'] = 'react-jsx'
  } else if (hasSolid) {
    compilerOptions['jsx']             = 'preserve'
    compilerOptions['jsxImportSource'] = 'solid-js'
  }
  // Vue only — no jsx field needed

  return JSON.stringify({
    compilerOptions,
    // ".rudder/**/*" is listed explicitly: dot-directories are invisible to
    // bare "**/*" globs AND to bare-directory includes (tsc only auto-expands
    // non-dotted dir names), and the generated type registries
    // (.rudder/types/*.d.ts) must be in the program for typed
    // view()/route()/Model.for<>() to resolve.
    include: ['src/**/*', 'pages/**/*', 'app/**/*', 'bootstrap/**/*', 'routes/**/*', 'config/**/*', '.rudder/**/*', '*.ts', '*.tsx'],
  }, null, 2) + '\n'
}
