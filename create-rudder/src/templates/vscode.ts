import type { TemplateContext } from '../templates.js'

// VS Code / Cursor scaffolder templates. Three files land in `.vscode/` so a
// fresh `npm create rudder` project is F5-debuggable out of the box — no manual
// launch.json authoring. Cursor reads the same files (it's a VS Code fork), so
// no separate `.cursor/` directory is needed.
//
// The `.vscode/` directory is committed (not gitignored): these configs describe
// project debug entry points, the same category as package.json scripts — not
// personal editor preferences. Users on other editors carry a small unused
// directory, deletable with one `rm -rf .vscode`.

/**
 * Three Node debug configurations. VS Code auto-injects `--inspect-brk` for
 * `request: "launch"`, so the flag is not set manually here.
 *
 * The dev-server config drives the `vike` bin directly (pm-agnostic — the bin is
 * always in `node_modules/.bin`); the rudder + test configs drive `tsx`/`node`
 * the same way the scaffolded `package.json` scripts do.
 */
export function launchJson(_ctx: TemplateContext): string {
  return JSON.stringify({
    version: '0.2.0',
    configurations: [
      {
        type:    'node',
        request: 'launch',
        name:    'Debug dev server',
        // Drive the vike bin directly so the config works regardless of the
        // package manager. autoAttachChildProcesses catches any worker the dev
        // server forks; sourcemaps let breakpoints hit in routes/, app/,
        // bootstrap/.
        runtimeExecutable:       '${workspaceFolder}/node_modules/.bin/vike',
        runtimeArgs:             ['dev'],
        console:                 'integratedTerminal',
        autoAttachChildProcesses: true,
        skipFiles:               ['<node_internals>/**'],
      },
      {
        type:    'node',
        request: 'launch',
        name:    'Debug rudder command',
        // Debugs `tsx node_modules/@rudderjs/cli/dist/index.js <cmd>` — F5 into
        // make:*, migrate, db:push, tinker, etc. The command is prompted for at
        // launch (see inputs below).
        runtimeExecutable: '${workspaceFolder}/node_modules/.bin/tsx',
        args: [
          '${workspaceFolder}/node_modules/@rudderjs/cli/dist/index.js',
          '${input:rudderCommand}',
        ],
        console:   'integratedTerminal',
        skipFiles: ['<node_internals>/**'],
      },
      {
        type:    'node',
        request: 'launch',
        name:    'Debug current test file',
        // Runs the active editor's file under node's test runner with tsx
        // loading TypeScript — `node --import tsx --test ${file}`.
        runtimeExecutable: 'node',
        runtimeArgs:       ['--import', 'tsx', '--test'],
        program:           '${file}',
        console:           'integratedTerminal',
        skipFiles:         ['<node_internals>/**'],
      },
    ],
    inputs: [
      {
        id:          'rudderCommand',
        type:        'promptString',
        description: 'rudder command to run (e.g. "make:model Post" or "migrate")',
        default:     'about',
      },
    ],
  }, null, 2) + '\n'
}

/**
 * Recommended extensions, populated from the scaffolder's answers. Vite is
 * always recommended; Tailwind / Prisma / Vue are added only when the project
 * actually uses them, so the recommendation prompt isn't noise.
 */
export function extensionsJson(ctx: TemplateContext): string {
  const recommendations = ['antfu.vite']
  if (ctx.tailwind)             recommendations.push('bradlc.vscode-tailwindcss')
  if (ctx.orm === 'prisma')     recommendations.push('Prisma.prisma')
  if (ctx.frameworks.includes('vue')) recommendations.push('Vue.volar')

  return JSON.stringify({ recommendations }, null, 2) + '\n'
}

/**
 * Minimal, opinionated workspace settings: use the project's own TypeScript
 * (not VS Code's bundled one) and don't enforce a formatter the user hasn't
 * chosen.
 */
export function settingsJson(): string {
  return JSON.stringify({
    'typescript.tsdk':      'node_modules/typescript/lib',
    'editor.formatOnSave':  false,
  }, null, 2) + '\n'
}
