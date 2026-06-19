# Email send history — rolling window (current stays only)

| Field | Value |
|---|---|
| **Status** | Approved |
| **Branch** | `feature/email-history-rolling-window` _(user-managed)_ |
| **Created** | 2026-06-19 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

GuestFlow already records every email it sends in the `email_log` table
([database.js:1049](../server/src/database.js#L1049)) — sent / failed / acknowledged-skip, with the
rendered subject + body, recipient, channel (`smtp` | `manual`). A read-only **history page already
exists** at `/emails/historique` ([EmailHistoryPage.js](../client/src/pages/EmailHistoryPage.js)),
reachable via the "Voir l'historique" button on the Emails page, backed by `emailLogModel.history()`
([emailLogModel.js:88](../server/src/models/emailLogModel.js#L88)) and `GET /api/emails/history`.

Two gaps vs. what the operator wants:
- The history is an **unbounded audit** — it shows every send ever, ordered by `sentAt DESC`. The operator
  only cares about emails for **stays that haven't happened yet**; old sends are noise.
- It is **not in the menu**, so it's easy to miss.

The operator wants the history scoped to **current/upcoming stays only**, with old entries **physically
removed** once a reservation is well past its arrival, and the page surfaced in the navigation.

## 2. Goal

The email history lists only sends whose reservation **hasn't passed arrival + 3 days** yet; entries past
that threshold are **automatically deleted**. The history is reachable from the sidebar (under "Emails").

## 3. Functional rules

1. **Single cutoff = arrival + 3 days.** An `email_log` entry is "current" while
   `today ≤ date(reservation.startDate, '+3 days')`, i.e. up to and including the 3rd day after arrival.
   Once `today > startDate + 3 days`, the entry is out of scope (hidden **and** purged). The cutoff is
   computed server-side in SQLite (`date(...)`) — never trusted from the client.
2. **Display filter.** `emailLogModel.history()` returns only rows whose reservation exists **and**
   `date(r.startDate, '+3 days') >= date('now')`. This makes the list correct even if the purge job
   hasn't run yet. Rows whose reservation was deleted (orphans — `email_log` has no FK cascade) are
   excluded (no `startDate` → can't be "current").
3. **Purge job.** A daily background task deletes every `email_log` row that is NOT current — i.e. where
   no reservation `r` exists with `r.id = l.reservationId AND date(r.startDate, '+3 days') >= date('now')`.
   This covers both past-window rows and orphans. Idempotent; also runs once at server start.
4. **Existing filters keep working.** The status / template / reservation filters already on the page
   combine with the window filter (AND).
5. **All statuses follow the window.** `sent`, `failed`, and `acknowledged-skip` rows all reference a
   reservation and are scoped + purged identically.
6. **Pagination total respects the window** — `total` counts only in-window rows (the page's "X résultats"
   and paging stay correct).
7. **Navigation.** "Emails" becomes a collapsible parent with two children: **Modèles** (`/emails`) and
   **Historique** (`/emails/historique`), mirroring the existing Calendrier / Paramètres parent pattern.

**Edge cases:**
- Reservation deleted after a send → the log row is an orphan → excluded from the list and purged.
- Stay longer than 3 days → still purged at arrival + 3 days (single cutoff, by decision), even though the
  guest may not have checked out yet.
- Reservation with arrival exactly today → shown (`today ≤ today + 3`).
- Empty/NULL `startDate` (shouldn't happen — `NOT NULL`) → treated as not-current → excluded + purged.
- The purge is destructive (rows are deleted, not archived) — this is the intended behavior; the history is
  a rolling operational view, not a permanent audit.

---

## 4. Architecture

> **Fat backend, thin frontend.** The window rule + purge are pure server concerns (SQLite date math). The
> client only renders the already-scoped list it receives and gains a menu entry.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `models/` | `models/emailLogModel.js` | T | `history()` gains the window predicate (`date(r.startDate,'+3 days') >= date('now')`) on both the COUNT and the SELECT. New `purgeRealizedStays()` → `DELETE FROM email_log WHERE NOT EXISTS (current reservation)`; returns the deleted count. A shared `STAY_RETENTION_DAYS = 3` constant. |
| `controllers/` | `controllers/emailsController.js` | — | No signature change — `history` already delegates to the model; the window is applied there. |
| `scheduledTasks.js` | `scheduledTasks.js` | T | Register a **daily purge tick** (once/day guard, mirrors the email-auto-send tick) + a one-shot purge at `startScheduledTasks()`. Calls `emailLogModel.purgeRealizedStays()`, logs the count when > 0. |
| `database.js` | `database.js` | — | No schema change (reuses `email_log` + `reservations.startDate`). The `idx_email_log_reservation` index already supports the purge join. |

**Notes:**
- Window + purge share one SQL predicate (kept DRY via the model). No new dependency.
- The purge is unit-testable against an in-memory DB (inject `today`).

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `App.js` | `App.js` | T | Make "Emails" a collapsible parent: `EMAILS_CHILDREN = ['/emails', '/emails/historique']`, an `emailsMenuOpen` state, and the parent + sub-items JSX (Modèles / Historique), mirroring the Calendrier group. |
| `pages/` | `pages/EmailHistoryPage.js` | T | Copy tweak only: title/subtitle clarifies it's the **current-stays** history (e.g. caption *« Séjours en cours et à venir — les envois sont retirés 3 jours après l'arrivée. »*). No structural change; the server returns the scoped set. |
| `api.js` | `api.js` | — | `getEmailHistory()` already exists; unchanged. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `DataPageScaffold`, `EmailLogViewDialog`, the existing nav `Collapse`/`ListItem` pattern | Reused as-is. |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | — | None. |

### 4.3 API contract

No new endpoints, no changed signatures.

| Method | Endpoint | Notes |
|---|---|---|
| GET | `/api/emails/history?limit&offset&status&templateId&reservationId` | Now returns only in-window rows; `total` counts in-window. Same row shape. |

---

## 5. Data model

- **No schema change.** Reuses `email_log` (audit rows) + `reservations.startDate` (arrival).
- **Retention:** `email_log` becomes a **rolling window** — rows are physically deleted once
  `today > startDate + 3 days` (or the reservation is gone). The daily purge job owns the deletion.

**Data impact:** the first purge after deploy deletes all historical `email_log` rows whose reservation is
already > arrival + 3 days (i.e. most existing audit rows). This is intended (operator decision). Documented
as a `Migration`/data note in the changelog. No reservation/client data is touched — only `email_log`.

## 6. UI / UX

**Where:** Paramètres → Emails → **Historique** (`/emails/historique`), now also linked in the sidebar.

- **List:** unchanged table (Date/heure, Modèle, Destinataire, Statut, Sujet, action « voir »), paginated,
  with the existing status / template / reservation filters — but only current-stay rows appear.
- **Copy:** a caption under the title explains the rolling window:
  *« Historique des emails pour les séjours en cours et à venir. Les envois sont automatiquement retirés
  3 jours après la date d'arrivée. »*
- **Empty state:** when no current-stay email exists, the existing empty state shows (no special-casing).
- **Sidebar:** "Emails" expands to **Modèles** + **Historique**. On `xs` the drawer collapses behind the
  menu icon as today; the sub-items are reachable once expanded (≥44px targets — MUI default).
- **Responsive:** no layout change; `DataPageScaffold` already handles `xs` (table scroll container).
- **PageActionBar:** `EmailHistoryPage` keeps its current header; no new page-level action.

## 7. Test plan

### Server unit tests (all green — 1645 total)
- [x] `tests/email-log-model.unit.test.js` (extend) — `history()` keeps in-window stays (incl. exactly
  `startDate + 3 days`), drops `startDate + 4 days` and orphans; `total` reflects the window; existing
  status/template/reservation filters still combine. The pre-existing history tests now pin `today`.
- [x] `tests/email-log-purge.unit.test.js` (new, +4) — `purgeRealizedStays(today)` deletes past-window +
  orphan rows, keeps in-window (incl. boundary), keeps all-current, removes every row for a past reservation;
  returns the count; idempotent.

### E2E (Playwright — `e2e/specs/emails/email-history-rolling-window.spec.js`, +1)
- [x] Reach the history from the sidebar ("Emails" → "Historique"); the rolling-window caption shows; a
  send for a current stay appears, a send for a stay arrived > 3 days ago does not. (New `dbSeed` helpers:
  `seedEmailLog`, `setReservationDates`.) Full suite green (25 passed).

### Manual UI verification
- [x] Sidebar: "Emails" expands to Modèles + Historique; both navigate correctly (E2E-verified).
- [ ] Mobile (`xs`): the history table scrolls; the sub-menu is reachable.

## 8. Out of scope

- The **French/English email language** feature (separate PR, per the operator).
- A permanent/archival audit of old sends (the history is explicitly rolling now).
- CSV export, full-text search on subject/body, date-range filter UI.
- Changing the cutoff to departure-based or making it configurable (fixed at arrival + 3 days).

## 9. Open questions

Resolved during scoping (2026-06-19):
- **Extend the existing history vs new page?** → Extend the existing `/emails/historique` (rolling window) +
  surface it in the menu.
- **Cutoff?** → Single threshold = arrival (`startDate`) + 3 days, for both display and purge.
