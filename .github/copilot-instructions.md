# RudderJS — Copilot Instructions

These rules apply to every PR opened by GitHub Copilot in this repo. Read before opening a PR. Violations of the **hard rules** below will get the PR rejected or rescoped.

---

## Hard rules

1. **No behavior changes without an explicit ask.** If the request is "add test coverage" or "fix bug X," do not also "fix" or "improve" any other code you happen to notice. Open a separate PR or file an issue.

2. **Every PR that touches `packages/*/src/` needs a `.changeset/<descriptive-name>.md` file.** Format:

   ```markdown
   ---
   '@rudderjs/<package>': patch
   ---

   <commit-style summary describing the change and its motivation>
   ```

   Multi-package changes use a single changeset listing each package on its own line. The changeset description ends up in the public CHANGELOG and release notes — write it for users, not maintainers.

3. **Semver discipline:**
   - Test-only, internal refactor, doc fix, comment-only edit → `patch`
   - New public API (new exported symbol, new method on an exported class, new optional config field) → `minor`
   - Removed/renamed/changed-signature public API; new **required** field on a contract; new required adapter method → `major`
   - When in doubt, **ask before opening the PR**. Getting semver wrong breaks downstream apps silently.

4. **One concern per PR.** "I noticed X while doing Y" → separate PR. A PR titled "test coverage" must contain only test additions. A bundled PR with mixed concerns will be split or rejected.

5. **PR title must accurately reflect the scope.** Use the conventional commit style with package scope: `test(orm): expand coverage` or `fix(support): Num.spell trillions`. If multiple packages are touched, list them: `test(view,localization,concurrency): expand coverage`. Vague titles ("improvements", "fixes", "updates") are not acceptable.

6. **Do not modify `CHANGELOG.md` or `package.json` `version` fields.** Changesets handles both during the version-packages PR. Editing them by hand creates conflicts.

7. **Do not invent APIs.** Every method, property, or symbol you reference in tests, docs, or example code must exist in the corresponding `src/index.ts` (or its re-exports). Verify before writing.

8. **Match existing test style.** This repo uses `node:test` + `node:assert/strict`. Don't introduce vitest, jest, mocha, or any other test runner. Don't change a test file's imports just to "modernize" them.

9. **Match existing code style.** Don't reformat unrelated lines. Don't rename internal variables for "clarity." Don't add `// eslint-disable-next-line` to suppress warnings — fix the underlying issue or leave it alone.

10. **Don't add libraries without asking.** New runtime dependencies, dev dependencies, or peer dependencies require explicit approval. If a stdlib alternative exists, use it.

---

## Verification before opening a PR

Run from the repo root:

```bash
pnpm typecheck    # must pass for every package the PR touches
pnpm --filter @rudderjs/<package> test    # must pass for every package the PR touches
pnpm lint                                 # 0 errors required (warnings tolerated only if pre-existing)
```

If any of these fail, fix it before opening the PR. Don't assume CI will catch it.

---

## What Copilot is good at in this repo

- **Test coverage gaps** in well-bounded utilities (e.g. `@rudderjs/support`'s `Str` / `Num` / `Collection`).
- **Targeted bug fixes** with a clear repro: "input X produces wrong output Y, expected Z."
- **Doc sweeps** to fix stale references, broken links, or version numbers.
- **Mechanical refactors** that don't change behavior (rename within a single file, extract a helper, etc.).

---

## What Copilot is NOT good at in this repo

Avoid asking Copilot for these without heavy supervision:

- **Cross-package refactors** — touching multiple `@rudderjs/*` packages in one go. Coordination across the dependency graph is hard for it to get right.
- **Anything touching the contract surface** in `@rudderjs/contracts`. Adding fields to `QueryBuilder`, `OrmAdapter`, or `ServerAdapter` is breaking for downstream adapters and needs careful semver judgment.
- **Migration plans** for breaking changes. It will silently change behavior without realizing it broke existing apps.
- **Performance optimizations** without a profiling justification. It will add caches and indices speculatively, adding complexity without measured benefit.
- **Anything touching the release pipeline** — `.changeset/`, `package.json` versions, GitHub Actions workflows.
- **Provider auto-discovery, DI container, middleware groups** — these are subtle framework internals where wrong assumptions cascade.

---

## When in doubt

Open a draft PR with a short description of what you intend to change and why. A maintainer will review the plan before you sink time into the implementation.

Better to ask than to ship a silent breaking change.
