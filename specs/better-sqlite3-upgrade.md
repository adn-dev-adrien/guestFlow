# better-sqlite3 11 → 13 (unpin Node, drop the teardown crash)

| Field | Value |
|---|---|
| **Status** | Draft |
| **Branch** | `chore/better-sqlite3-upgrade` _(user-managed)_ |
| **Created** | 2026-08-07 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

On **2026-08-06**, hours after a green run on the same code, every CI run of `Unit tests` went red on
`master`: **214 test files reported as failed**, while the assertions themselves all passed
(thousands of ✔ in the log). The processes were dying on the way OUT:

```
node[6015]: void node::RemoveEnvironmentCleanupHook(v8::Isolate*, CleanupHook, void*)
Assertion failed: (env) != nullptr
 3: Statement::~Statement()  [server/node_modules/better-sqlite3/build/Release/better_sqlite3.node]
 4: Database::~Database()    [ … ]
```

| Run on `master` | Node | Result |
|---|---|---|
| 2026-08-06 10:29 UTC (`affeeff`) | **24.18.0** | ✅ |
| 2026-08-06 20:35 UTC (`ededbc5`) | **24.19.0** | ❌ 214 files |

The workflows pinned the **floating major** `node-version: '24'`, so the runners picked up the
24.19.0 patch released that day. That release is incompatible with the N-API environment-cleanup
hooks of **better-sqlite3 ^11**, which the server still depends on while **13.0.3** is current.

Immediate mitigation shipped separately (`fix/pin-node-24-18`): the three workflows
(`unit-tests.yml`, `e2e.yml`, `deploy.yml`) pin `24.18.0`. That restores green but **freezes the
Node patch line** — including security patches — so it is a stopgap, not the fix.

`better-sqlite3` is the single DB driver of the whole app (`server/src/database.js` + every model),
and it is a **native module**: it is compiled from source on the Raspberry Pi at deploy time and must
match the Pi's `NODE_MODULE_VERSION`. That is what makes this a spec'd change rather than a bump.

## 2. Goal

Run the server on a `better-sqlite3` release that is compatible with current Node 24.x, so the CI
workflows can go back to the floating `node-version: '24'` and the Pi can take Node patches without
the app breaking at shutdown.

## 3. Functional rules

1. `server/package.json` moves from `better-sqlite3: ^11.0.0` to the current major (**13.x**), and
   `package-lock.json` is regenerated.
2. **No behaviour change is expected.** The app must pass the full suites unchanged: any test that
   needs editing is a signal to investigate, not to adapt the test.
3. Every API the codebase uses must be re-checked against the 12.x and 13.x changelogs — notably
   `db.prepare().run/get/all/iterate`, `db.transaction()`, `db.exec()`, `PRAGMA table_info`,
   `db.backup()` if used, and the `:memory:` constructor used by ~all unit tests.
4. **BigInt / integer handling**: verify `safeIntegers` defaults did not change; every money column is
   `REAL` and every id `INTEGER`, so a silent BigInt switch would surface as `[object BigInt]` in
   payloads.
5. The three workflows go back to `node-version: '24'` (floating major) in the same PR, and the
   comments explaining the 2026-08-06 pin are removed.
6. **Deploy path**: `deploy.yml` rebuilds the native module on the Pi (`build-from-source`). The Pi's
   Node major must still match the workflow pin — check `node -v` on the Pi before merging, and keep
   the existing ABI-mismatch guard.
7. Rollback plan: the pin commit is a one-line revert per workflow; the dependency bump is a
   `package.json` + lockfile revert. Both are independent.

**Edge cases:**
- The Pi runs an older Node major than the runners → the bump must wait for the Pi to be updated
  (the deploy comment already ties the two together).
- A 13.x release requires a newer glibc / build toolchain than the Pi's OS provides → fall back to
  12.x, which is the last line before the 13 major.
- An intermediate 12.x is enough to fix the teardown assert → prefer the smallest hop that works,
  and say so in the PR.

---

## 4. Architecture

> Dependency + CI change only. No app logic, no schema, no payload shape.

### 4.1 Server side (`server/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| deps | `package.json` | T | `better-sqlite3` version range. |
| deps | `package-lock.json` | T | Regenerated (`npm install`, not hand-edited). |
| `database.js` | `src/database.js` | ? | Only if a constructor option or a PRAGMA call changed shape. Expected untouched. |
| `models/` | — | — | Expected untouched (prepared statements + transactions are stable API). |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| — | — | — | None. |

### 4.3 CI

| File | T/C | Responsibility |
|---|---|---|
| `.github/workflows/unit-tests.yml` | T | Back to `node-version: '24'`; drop the pin comment. |
| `.github/workflows/e2e.yml` | T | Idem. |
| `.github/workflows/deploy.yml` | T | Idem, keeping the "must match the Pi's major" comment. |

---

## 5. Data model

No schema change. The SQLite **file format is unchanged** across better-sqlite3 majors (they track
the same SQLite engine family); the existing `guestflow.db` opens as-is.

**Data impact:** none expected. Still, take a copy of the Pi's `data/guestflow.db` before the first
deploy of the new driver — a native driver swap is the one class of change where a corrupt-on-write
regression would be silent.

## 6. UI / UX

None (no user-visible change). If the bump were to alter a payload (rule 4), that would be a bug to
fix, not a UX decision.

## 7. Test plan

### Server unit tests
- [ ] `cd server && npm test` — the full suite green, **unchanged**, on Node 24 latest (not 24.18.0).

### Client
- [ ] `cd client && npx vitest run` — unaffected, run as a regression guard.

### E2E
- [ ] `npm run test:e2e` — exercises the real server + a real SQLite file, so it is the meaningful
      integration check for a driver swap.

### Manual
- [ ] Boot the dev server on a **fresh** DB (`rm server/guestflow.db`) → every migration applies.
- [ ] Boot on the **existing** dev DB → no migration re-runs, no corruption.
- [ ] Exercise a write-heavy path (create a reservation, run an arrival SAS, settle a note) and a
      read-heavy one (Finance + Comptabilité pages).
- [ ] After deploy: `pm2 logs guestflow` clean on restart (this is where the teardown assert showed).

## 8. Out of scope

- Migrating off better-sqlite3 (e.g. to `node:sqlite`, now built into Node) — worth its own study;
  the built-in module would remove the native-build step on the Pi entirely.
- Bumping the Pi's Node major.
- Any schema or query rewrite.

## 9. Open questions

- Q: 12.x or 13.x — which is the smallest hop that fixes the teardown assert on current Node 24?
  - A: to determine by running the suite against each on a CI branch.
- Q: does the Pi's OS toolchain build 13.x from source?
  - A: to verify on the Pi before merging (that is the deploy-blocking unknown).
