# Migrations baseline — schema.sql as the single source of truth

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `chore/migrations-baseline` |
| **Created** | 2026-06-17 |
| **Author** | Adrien |
| **Touches** | `server/src/schema.sql` (new), `server/src/database.js` |

---

## 1. Context

`database.js` had grown to ~2185 lines: a base `CREATE TABLE` for each table **plus ~212 guarded
`ALTER TABLE ADD COLUMN` migrations** accreted over time, interleaved with one-time data backfills and
seeds. The "current schema" was therefore `CREATE TABLE` (base) **+ all migrations** — the `CREATE TABLE`
statements alone were an **incomplete** schema, and had even drifted from production (e.g.
`reservations.finalPrice`/`totalPrice` were `NOT NULL DEFAULT 0` on prod but nullable in the base
`CREATE`). With a single prod server already carrying the full schema, the legacy ALTER migrations are
no-ops there — but they can't simply be deleted, because a **fresh** DB (dev reset, CI/e2e, disaster
recovery) is built from the code and would be missing ~200 columns.

## 2. Goal

Make the **complete schema** the single source of truth so the legacy migrations can be removed without
breaking fresh installs, and so a fresh DB reproduces **production exactly**.

## 3. Approach (decision 2026-06-17 — « baseline sûre + gros bloc »)

1. **`server/src/schema.sql`** — the full schema (43 tables + 45 indexes), generated from the **exact
   production DDL** (`sqlite_master`), transformed to `CREATE … IF NOT EXISTS`. It is **executed first**
   in `database.js`, so it is authoritative.
2. The big contiguous schema-migration block (the `SKIP_MIGRATIONS` guard, ~212 `ALTER ADD COLUMN` + the
   3 one-time data backfills it contained: ical-summary, client-phone, resource-property) **and** the now
   redundant base `CREATE TABLE` block were **removed** (database.js 2185 → 1246 lines). With schema.sql
   run first, any remaining guarded `CREATE IF NOT EXISTS` / `ALTER` in the tail are harmless no-ops.
3. **Kept**: all seeds (admin user, app_settings row, school holidays, default options, platforms, repair
   amounts, email templates…), the scattered tail migrations (guarded, now no-ops), and the devis-fusion
   boot logic (self-guarding, harmless on a fresh/clean DB).

Removed data migrations are safe: on prod they already ran; on a fresh DB they are no-ops (no old data),
and the column defaults / seeds produce the correct initial state.

## 4. Verification (the protocol Adrien specified)

Done against a **read-only copy of the live production DB** pulled to dev:

- **Before** — current code, dev DB: server suite green (reference).
- **Fresh DB from the new code** — `PRAGMA`-level schema diff vs the prod copy → **identical** (columns,
  types, NOT NULL, defaults, PK, indexes). Seeds all present (admin/user_roles, app_settings, 15 school
  holidays, 3 default options, platform `direct`, baby-bed resource, repair amount).
- **Prod copy booted on the new code** — boots clean, **data intact** (36 reservations / 15 options / 37
  clients / 2 users unchanged), no `devis` table, schema unchanged.
- **Full server suite** — 1599 tests pass.

## 5. Maintenance rule going forward

- A **new column / table** → add it to `schema.sql` (and to the relevant model/queries).
- If **existing rows** must be transformed, add a **guarded** migration in `database.js` (idempotent;
  e.g. a `migrations`-table entry or a column-existence check) **in addition** to the schema.sql change.
- Never rely on "no link / empty = …" implicit schema; `schema.sql` is the contract.

## 6. Out of scope

- Trimming the remaining scattered tail migrations / dead migration util files (harmless no-ops; a later
  pass can remove them, re-verifying fresh == prod).
