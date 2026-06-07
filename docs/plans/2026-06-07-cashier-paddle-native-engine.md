# cashier-paddle: native-engine support

**Filed:** 2026-06-07 (pilotiq-io native-engine migration)
**Package:** `@rudderjs/cashier-paddle` (4.4.1)
**Severity:** blocks any cashier-paddle app from adopting `engine: 'native'`

## Problem

The five cashier models still carry **Prisma delegate names** in `static table`
(`'paddleCustomer'`, `'paddleSubscription'`, …) — see the comment in
`src/models/Customer.ts`: *"`static table` is the Prisma delegate name … The ORM
does `prisma[this.table]`"*. That contract no longer holds: on the native engine
`Model.getTable()` returns `static table` as the **literal SQL table name**
(`packages/orm/src/index.ts:1850`), so every query targets a nonexistent
`paddleCustomer` table instead of the real `paddle_customers` (the `@@map` name
from the vendored prisma fragment).

Second gap: the models use string cuid PKs that **Prisma generated client-side**
(`@default(cuid())`). The native engine only stamps app-generated keys when
`static keyType = 'uuid' | 'ulid'` is set (`index.ts:3094`); cashier models leave
the default `'int'`, so `Customer.create()` on native inserts a NULL primary key.

Timestamps are NOT affected — the native Model layer's schema-gated camelCase
`createdAt`/`updatedAt` stamping (orm 2026-06-06 fix) matches the prisma columns.

## Proposed fix

1. `static override table` → the SQL names: `paddle_customers`,
   `paddle_subscriptions`, `paddle_subscription_items`, `paddle_transactions`,
   `paddle_webhook_logs`. (On the prisma engine the adapter should map SQL name →
   delegate, or keep a per-engine alias — whichever the orm-prisma bridge
   prefers; the delegate-name-in-`table` contract is the wrong layer.)
2. `static override keyType = 'ulid'` on all five (new rows ulid, existing cuid
   rows are opaque strings — coexistence is safe).
3. Ship a native migration fragment (sibling of `schema/cashier-paddle.prisma`)
   or document the hand-written blueprint, so `vendor:publish` works for
   native-engine apps.

## Workaround in the meantime (pilotiq-io)

Boot-time shim in the app's provider patches the five exported model classes:
`Customer.table = 'paddle_customers'; Customer.keyType = 'ulid'; …` — remove
once this plan ships. Verified: no other code path in cashier-paddle src touches
the prisma client directly; all DB access goes through the Model statics, so the
table+keyType patch covers the whole runtime (billable.ts, webhooks/handler.ts,
routes, state.ts).

## Addendum (same migration): ORM timestamp stamping breaks on MySQL

`Model._ensureTimestamps` (`packages/orm/src/index.ts:3168`) stamps
`new Date().toISOString()` — the sqlite TEXT wire format. MySQL strict mode
rejects the trailing `Z`: `Incorrect datetime value: '2026-06-07T17:20:12.654Z'
for column 'createdAt'`, so EVERY `Model.create()`/`save()` on a
timestamps-enabled table fails on the native MySQL engine. (Direct `Date`
values in payloads bind fine — mysql2 formats them natively; only the
auto-stamp path is broken. Soft-delete `deletedAt` stamping likely shares the
bug.)

**Proposed fix:** stamp `Date` objects and let each driver serialize (sqlite
driver would normalize Date → ISO string at bind time), or thread the dialect
into the stamping site.

**pilotiq-io workaround:** `AppServiceProvider` re-assigns
`Model._ensureTimestamps` with a Date-stamping copy (same logic, different wire
type). Remove together with the cashier shim.

Also worth noting from the same migration: `NativeAdapter` calls
`MysqlDriver.open({ url })` without plumbing `config.options` from the
connection config — apps can't set mysql2 pool options (e.g. `timezone`)
declaratively.
