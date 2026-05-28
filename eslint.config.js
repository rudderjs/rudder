// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  // ── Ignored paths ──────────────────────────────────────────────
  {
    ignores: [
      '**/dist/**',
      '**/dist-test/**',
      '**/.vitepress/cache/**',
      '**/.vitepress/dist/**',
      '**/node_modules/**',
      'playground/**',
      // RudderJS-maintained fork of upstream vike-react-rsc (MIT; see its
      // README). Not held to RudderJS lint rules — reformatting it would
      // diverge from upstream and complicate re-syncing from there.
      'packages/vike-react-rsc/**',
    ],
  },

  // ── Base JS rules ──────────────────────────────────────────────
  js.configs.recommended,

  // ── TypeScript rules (all .ts / .tsx files) ────────────────────
  ...tseslint.configs.recommended,

  {
    rules: {
      // Allow `any` but warn — don't error, too many legitimate cases in adapters
      '@typescript-eslint/no-explicit-any': 'warn',

      // Unused vars: ignore underscore-prefixed
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],

      // Empty catch blocks are intentional in some adapters (optional deps)
      'no-empty': ['warn', { allowEmptyCatch: true }],

      // Allow require() in CJS interop contexts
      '@typescript-eslint/no-require-imports': 'warn',

      // Don't force return types everywhere — inference is fine internally
      '@typescript-eslint/explicit-module-boundary-types': 'off',

      // namespace is used in some legacy d.ts patterns
      '@typescript-eslint/no-namespace': 'off',

      // non-null assertion is sometimes the right call
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // ── Code-quality rules (CodeQL Quality Suite parity) ─────────
      // Same rule classes as the CodeQL Quality Suite covers — catching
      // them at dev-time in the editor + `pnpm lint` is faster feedback
      // than a weekly post-merge scan.

      // `==` / `!=` → require `===` / `!==`. `== null` is still allowed
      // (idiomatic null-OR-undefined check); `null` is the only exception.
      eqeqeq: ['error', 'smart'],

      // `cond ? true : false` and `cond ? false : true` — collapse to
      // `cond` / `!cond`. Catches `js/trivial-conditional` cases.
      'no-unneeded-ternary': ['error', { defaultAssignment: false }],

      // `+x` / `!!x` / `'' + x` / etc. as type coercions — explicit
      // `Number(x)` / `Boolean(x)` / `String(x)` is clearer.
      // Allow `!!x` (boolean coercion is widely-read idiom).
      'no-implicit-coercion': ['error', { boolean: false }],

      // `no-use-before-define` deliberately NOT enabled — the framework uses
      // the facade-then-impl class pattern (e.g. `AnthropicProvider` declared
      // before `AnthropicAdapter` it instantiates) and lazy template-constant
      // references inside arrow functions (e.g. `add.ts`'s `CFG_*` map). Both
      // are safe at runtime; ESLint can't see through them.
    },
  },

  // ── React files (all .tsx + hook .ts files) ────────────────────
  {
    files: ['**/*.tsx', '**/pages/_hooks/**/*.ts'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // rules-of-hooks violations (hooks after early returns) are a known
      // architectural pattern in panels pages — warn, don't error, until refactored
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // ── Test files — relax rules ───────────────────────────────────
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
)
