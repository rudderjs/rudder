# Auto-Audit Playbook

The runbook for the **recurring per-package audit** of the RudderJS framework. A scheduled
cloud agent (a `/schedule` cron routine) reads this file and the rotation tracker on every
fire, audits exactly one package across six dimensions, and files capped, deduplicated issues.

The cron prompt is intentionally tiny (*"read `claude-notes/auto-audit-playbook.md` and the
rotation tracker, then audit the next package per the playbook"*). All behavior lives here so it
can be tuned in a PR without ever touching the schedule.

> Writing rule for this routine: never use the em-dash character in any issue title, body, or
> comment. Use a regular hyphen with spaces, a colon, or parentheses, or rephrase the sentence.

---

## 1. Goal & posture

- **Output is issues, not code.** Every run files well-scoped GitHub issues. It NEVER opens PRs,
  edits source, or pushes. A human triages the queue and decides what to build.
- **Recurring, one package per run.** Coverage rotates through every package; a full cycle takes
  roughly as many days as there are packages (about 7 weeks at one per day).
- **Read-only analysis.** Auditor subagents read, grep, and reason. They do not run destructive
  commands, mutate the repo, or call external services beyond GitHub issue search and creation.
- **Anti-noise is the priority.** A tracker that fills with near-duplicate or low-value issues is
  worse than no tracker. The caps and dedup rules in section 6 are hard requirements, not
  suggestions.

---

## 2. State lives in GitHub (the cloud has no memory)

A cron agent starts fresh every run. Three pieces of state must be read from / written to GitHub:

| State | Where it lives | How it's read | How it's written |
|---|---|---|---|
| Which package is next | The **rotation tracker** issue (labeled `audit:tracker`) | `gh issue list --label audit:tracker` then read the body table | `gh issue edit <n> --body-file ...` (update one row) |
| What was already filed | All-time issues labeled `audit:auto` | `gh issue list --state all --label audit:auto ...` | n/a (created issues carry the label) |
| What came back clean | The tracker row's "Dimensions clean" column | same as above | same as above |

The rotation tracker is the single source of truth and a human-readable dashboard in one. Find it
by label (`audit:tracker`), never by a hardcoded issue number.

---

## 3. The daily run loop

1. **Locate the tracker** via `gh issue list --label audit:tracker --state open`. If none exists,
   STOP and report (setup incomplete).
2. **Pick the package**: parse the tracker table; choose the row with the oldest `Last audited`
   date. `never` sorts before any date. Ties broken by the section 9 priority order
   (security-sensitive first). Exactly one package per run.
3. **Fan out 6 auditors in parallel**, one read-only subagent per dimension (section 4), each
   scoped to the chosen package directory and returning structured findings (section 5).
4. **Dedup + cap**: for each finding, run the section 6 gate. Drop duplicates and anything past
   the cap.
5. **File issues**: create the survivors with the section 7 template, the section 8 labels, AND
   assigned to `suliemandev`.
6. **Update the tracker**: set the row's `Last audited` to today (pass the date in via
   `date -u +%Y-%m-%d`; the agent's clock may be unavailable), `Last findings` to the count filed,
   `Dimensions clean` to the dimensions that produced zero filed issues.
7. **Post a run summary**: a comment on the tracker with the package, per-dimension counts, links
   to new issues, and anything skipped as a duplicate.

---

## 4. The six dimensions

Each auditor is scoped to `packages/<pkg>/` and the package's docs. Findings must name a concrete
file/symbol and explain impact (no vague "consider improving X").

| # | Dimension | In scope | Explicitly out of scope |
|---|---|---|---|
| 1 | **Security** (`audit:security`) | Adversarial read: injection (SQL/command/path), auth & authz bypass, unsafe deserialization, secret/credential handling, SSRF, prototype pollution, ReDoS, missing input validation on a trust boundary. | Theoretical issues with no reachable path; dependency CVEs (Dependabot owns those). |
| 2 | **Laravel parity** (`audit:parity`) | Gaps vs the equivalent Laravel subsystem at the **latest Laravel release** (12.x, and 13.x once GA). Missing first-class APIs, ergonomics, or lifecycle hooks a Laravel dev would expect. Seed from `claude-notes/ai-sdk-comparison.md` and `claude-notes/db-orm-comparison.md` where relevant. | Deliberate divergences already documented in CLAUDE.md / comparison notes; PHP-only idioms that don't translate to TS. |
| 3 | **Docs & guides** (`audit:docs`) | Public API not covered in `docs/`, stale/incorrect examples, missing guide page for a shipped feature, broken cross-references. | Typo-only nits (batch those, don't file individually); internal code comments. |
| 4 | **Missing tests** (`audit:tests`) | Untested public methods, uncovered error paths, missing edge-case/regression coverage for a known pitfall in CLAUDE.md. | Coverage-percentage targets; testing private internals. |
| 5 | **Code quality** (`audit:quality`) | Logic duplication (same algorithm in 2+ places), dead code, oversized/repeated functions, leaky abstractions. Must point at specific duplicated spans. | Pure style/formatting (lint owns that); subjective naming preferences. |
| 6 | **DX** (`audit:dx`) | Unclear error messages, footguns, missing types/scaffolders, awkward setup, anything that would make a "did-you-mean"-class improvement. | Feature requests unrelated to developer ergonomics. |

---

## 5. Finding schema (what each auditor returns)

```
{
  dimension: "security" | "parity" | "docs" | "tests" | "quality" | "dx",
  severity:  "high" | "medium" | "low",
  title:     "<short, specific; used for the dedup fingerprint and issue title>",
  location:  "packages/<pkg>/src/<file>.ts:<line> (symbol)",
  rationale: "<why it matters plus concrete impact>",
  suggestion:"<the shape of a fix, NOT code, a direction>"
}
```

---

## 6. Dedup & caps (hard requirements)

Before filing ANY finding:

1. **Fingerprint** = lowercased, stop-word-stripped `title`. Search existing issues:
   `gh issue list --state all --label audit:auto --search "<pkg> <key terms>"`.
2. **Skip if an OPEN issue** has a substantially-equivalent title/fingerprint for this package.
3. **Skip if a CLOSED issue** matches and was closed within the last **90 days** (it was likely
   triaged-and-declined; don't re-litigate). Older than 90 days may re-file.
4. **Per-dimension cap: 2.** If a dimension yields more, keep the 2 highest-severity (ties go to
   the most concrete/actionable). Note the dropped count in the run summary.
5. **Per-run cap: 12** (6 dimensions x 2). Never exceed.
6. A dimension that produces zero survivors is recorded as **clean** in the tracker, NOT as an
   issue.

If in doubt whether something is a duplicate or low-value, **don't file it.** Under-filing is
recoverable next cycle; noise erodes trust in the whole system.

---

## 7. Issue template

**Title:** `[<pkg-short>] <dimension>: <specific summary>`
(e.g. `[passport] security: scope check skipped when token has no audience claim`)

**Assignee:** `suliemandev` (always).

**Body:**
```markdown
> Filed by the auto-audit routine. Dimension: <dimension>. Severity: <high|medium|low>.

## What
<one-paragraph description of the finding>

## Where
`packages/<pkg>/src/<file>.ts:<line>` (`<symbol>`)

## Why it matters
<concrete impact: what breaks, who's affected, attack/failure scenario>

## Suggested direction
<the shape of a fix, not a PR, a starting point>

---
<sub>audit:auto · package @rudderjs/<pkg> · cycle <date></sub>
```

(Reminder: no em-dash character anywhere in the title or body.)

---

## 8. Labels & assignee

Every filed issue gets, at minimum:

- `audit:auto` (provenance). Lets you bulk-filter / bulk-close the entire stream. **Always.**
- The dimension label: `audit:security` | `audit:parity` | `audit:docs` | `audit:tests` |
  `audit:quality` | `audit:dx`.
- `area:<pkg>` (the package area label).
- A priority from the severity map (section 9).
- **Assignee `suliemandev`** on every filed issue (`gh issue create ... --assignee suliemandev`).

`audit:tracker` is reserved for the single rotation tracker issue; never put it on a finding.

---

## 9. Severity to priority & rotation seeding

| Severity | Priority label |
|---|---|
| high (security/data-loss/auth) | `priority:p1` |
| medium | `priority:p2` |
| low | `priority:p2` (no p3 label exists; keep p2) |

**Rotation seed order** (most security/blast-radius-sensitive first, so the riskiest surface is
covered earliest in the very first cycle):

1. passport, auth, session, sanctum, crypt, server-hono
2. core, router, middleware, http, contracts, support
3. database, orm, orm-prisma, orm-drizzle, cache, queue
4. storage, mail, broadcast, notification, socialite
5. everything else, alphabetically

After cycle 1, order is purely by oldest `Last audited`; seed order only matters for the first
pass.

---

## 10. Failure modes & guardrails

- **No GitHub auth in the sandbox**: the audit runs but `gh issue create` fails. The routine must
  detect this early (a `gh auth status` probe) and abort with a clear report rather than losing the
  analysis silently.
- **Tracker missing/malformed**: STOP, report. Do not guess a package.
- **A subagent errors**: record that dimension as "not run" in the summary (NOT "clean") so it's
  retried, and continue with the others.
- **Tune by PR**: change caps, dimensions, templates, or rotation here. The schedule never changes.
