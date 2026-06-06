import { registerDoctorCheck, type DoctorResult } from '@rudderjs/console'
import { fileExists, readFileSafe, anyExists } from './_fs.js'

registerDoctorCheck({
  id:       'structure:bootstrap-app',
  category: 'structure',
  title:    'bootstrap/app.ts',
  run(): DoctorResult {
    if (!fileExists('bootstrap/app.ts')) {
      return {
        status:  'error',
        message: 'missing',
        fix:     'Scaffold a fresh app via `pnpm create rudder@latest`, or write bootstrap/app.ts using Application.configure({...}).create()',
      }
    }
    // Lexical-parse only — we deliberately don't import the module here
    // (it boots providers and would defeat the skip-boot fast path).
    const text = readFileSafe('bootstrap/app.ts') ?? ''
    if (!/Application\.configure/.test(text)) {
      return {
        status:  'warn',
        message: 'present but does not call Application.configure(…)',
        fix:     'See docs/guide/bootstrap.md for the expected shape',
      }
    }
    return { status: 'ok', message: 'parses' }
  },
})

registerDoctorCheck({
  id:       'structure:bootstrap-providers',
  category: 'structure',
  title:    'bootstrap/providers.ts',
  run(): DoctorResult {
    if (!fileExists('bootstrap/providers.ts')) {
      return {
        status:  'error',
        message: 'missing',
        fix:     'Create bootstrap/providers.ts with `export default [...(await defaultProviders())]`',
      }
    }
    const text = readFileSafe('bootstrap/providers.ts') ?? ''
    if (!/export\s+default/.test(text)) {
      return {
        status:  'warn',
        message: 'present but has no default export',
        fix:     'bootstrap/providers.ts must `export default [...]`',
      }
    }
    return { status: 'ok', message: 'has default export' }
  },
})

registerDoctorCheck({
  id:       'structure:routes',
  category: 'structure',
  title:    'routes/*',
  run(): DoctorResult {
    const have = ['routes/web.ts', 'routes/api.ts', 'routes/console.ts'].filter(fileExists)
    if (have.length === 0) {
      return {
        status:  'error',
        message: 'no routes/* files found',
        fix:     'Create at least one of routes/web.ts, routes/api.ts',
      }
    }
    return { status: 'ok', message: have.join(', ') }
  },
})

registerDoctorCheck({
  id:       'structure:rudder-types-tsconfig',
  category: 'structure',
  title:    '.rudder/ generated types in tsconfig',
  run(): DoctorResult {
    // `.rudder/types/` holds the generated type registries (typed views /
    // routes / models). They only work when tsc includes the directory —
    // and dot-directories are invisible to bare `**/*` globs AND to
    // bare-directory include entries, so the glob form is required.
    if (!anyExists(['.rudder/types'])) {
      return { status: 'ok', message: 'no .rudder/ yet (created on first dev/build)' }
    }
    const text = readFileSafe('tsconfig.json')
    if (text === null) {
      return {
        status:  'warn',
        message: '.rudder/ exists but tsconfig.json is missing or unreadable',
        fix:     'Add a tsconfig.json with ".rudder/**/*" in its include array',
      }
    }
    // A working entry references a path UNDER .rudder/ (e.g. ".rudder/**/*").
    if (/["']\.?\/?\.rudder\/[^"']*["']/.test(text)) {
      return { status: 'ok', message: 'included' }
    }
    // The bare directory form does NOT work — tsc only auto-expands
    // non-dotted directory names.
    if (/["']\.?\/?\.rudder["']/.test(text)) {
      return {
        status:  'warn',
        message: 'tsconfig lists bare ".rudder" — tsc ignores dotted directory includes',
        fix:     'Change the include entry to ".rudder/**/*"',
      }
    }
    return {
      status:  'warn',
      message: '.rudder/ exists but tsconfig include does not cover it — typed view()/route()/Model.for<>() will not resolve',
      fix:     'Add ".rudder/**/*" to the tsconfig.json include array',
    }
  },
})

registerDoctorCheck({
  id:       'structure:welcome-view',
  category: 'structure',
  title:    'Welcome view / index page',
  run(): DoctorResult {
    // The scaffolder ships one of these depending on the recipe:
    //   - Controller-view mode: app/Views/Welcome.* (with `export const route = '/'`)
    //   - Vike-direct mode:     pages/index/+Page.*
    const viewCandidates = [
      'app/Views/Welcome.tsx', 'app/Views/Welcome.vue', 'app/Views/Welcome.jsx',
      'app/Views/Welcome.ts',  'app/Views/Welcome.js',  'app/Views/Welcome.html',
    ]
    const pageCandidates = [
      'pages/index/+Page.tsx', 'pages/index/+Page.vue', 'pages/index/+Page.jsx',
      'pages/index/+Page.ts',
    ]
    if (anyExists(viewCandidates) || anyExists(pageCandidates)) {
      return { status: 'ok', message: 'found' }
    }
    return {
      status:  'warn',
      message: 'no landing page found',
      fix:     'Add app/Views/Welcome.tsx (with `export const route = \'/\'`) or pages/index/+Page.tsx',
    }
  },
})
