# Mark a pending email as sent (sent outside GuestFlow)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/mark-email-sent-manually` _(user-managed)_ |
| **Created** | 2026-06-12 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The "Emails à envoyer" queue on `/emails` offers two row actions today: **send** (via GuestFlow's SMTP →
logs `email_log.status='sent'`) and **Ignorer** (acknowledge → logs `acknowledged-skip`, leaves the
queue). Both remove the pair from the queue (the queue excludes pairs with a `sent` / `acknowledged-skip`
row, and `email_manual_queue` rows are dequeued).

But the operator often sends the message **from the booking platform's own messaging** (Airbnb, Booking,
…) rather than through GuestFlow. There is currently no way to record "I sent this myself, elsewhere": the
only options are to re-send via SMTP (duplicate) or to "Ignorer" it (which reads as *skipped*, not
*sent* — wrong for the audit trail).

## 2. Goal

From "Emails à envoyer", the operator can **mark a pending email as sent** in one click. It leaves the
queue and is recorded in the history as **sent**, visually distinguished as sent manually (outside
GuestFlow), without GuestFlow sending anything.

## 3. Functional rules

1. Each pending row gains a **« Marquer comme envoyé »** action, alongside the existing send (row click)
   and **Ignorer**.
2. Marking logs an `email_log` row with `status='sent'` and **`channel='manual'`** (real SMTP sends use
   `channel='smtp'`). The pair then leaves the queue (same `status='sent'` exclusion as a real send) and,
   if it was manually queued, its `email_manual_queue` row is removed.
3. The rendered subject/body are still computed (server-side, from the live template + reservation) and
   stored on the log row, so the history entry shows what was (conceptually) sent.
4. **No recipient is required.** Unlike send, marking does not need a client email and never contacts
   SMTP — the operator sent it through another channel. `recipientEmail` is the client's email if on
   file, else empty.
5. **Idempotent:** marking a pair that already has a `sent` / `acknowledged-skip` row is a no-op
   (`alreadyHandled`), but still dequeues any `email_manual_queue` row.
6. The **history** page shows a **« Envoyé manuellement »** badge for `channel='manual'` rows (distinct
   from the plain « Envoyé » SMTP badge). The existing status filter is unchanged (both are `sent`).
7. All logic is server-side; the client only adds the action button + the history badge.

**Edge cases:**
- Client without an email → marking still works (rule 4).
- A real SMTP send keeps `channel='smtp'` (default); existing historical rows backfill to `'smtp'`.
- SMTP not configured → irrelevant to marking (no send attempted).

---

## 4. Architecture

> **Fat backend, thin frontend.** Channel semantics, rendering, queue removal, and the sent-vs-manual
> distinction live on the server. The client renders one new button + one history badge.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` | `database.js` | T | Idempotent migration: `ALTER TABLE email_log ADD COLUMN channel TEXT NOT NULL DEFAULT 'smtp'` (guarded by a column-exists check, like the other additive migrations). |
| `models/` | `models/emailLogModel.js` | T | `insert` accepts `channel` (default `'smtp'`); `SELECT_COLS` + `history()` expose `channel`. |
| `controllers/` | `controllers/emailsController.js` | T | New `markSent(req,res)`: render → insert `status='sent', channel='manual'` → dequeue `email_manual_queue`. Idempotent guard like `acknowledge`. The existing SMTP `send()` passes `channel='smtp'` explicitly. |
| `routes/` | `routes/emails.js` | T | `POST /api/emails/pending/:templateId/:reservationId/mark-sent` → `controller.markSent`. |
| `utils/` | `emailAutoSendRunner.js` | T | Cron `sent` rows also stamped `channel='smtp'` (explicit, matches default). |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `components/EmailPendingList.js` | T | Add a **« Marquer comme envoyé »** action per row (`onMarkSent`), beside « Ignorer ». |
| `pages/` | `pages/EmailTemplatesPage.js` | T | `handleMarkSent(row)` → `api.markEmailSent` → `reloadPending()`; wire it into `EmailPendingList`. |
| `pages/` | `pages/EmailHistoryPage.js` | T | Show a **« Envoyé manuellement »** badge when `row.channel === 'manual'` (else the existing « Envoyé »). |
| `api.js` | `api.js` | T | `markEmailSent({ templateId, reservationId })`. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `EmailPendingList`, the history status-badge rendering | Extended, not duplicated. |
| **Created (new generic)** | — | None. |

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| POST | `/api/emails/pending/:templateId/:reservationId/mark-sent` | — | `200 { ok:true, emailLogId }` or `{ ok:true, alreadyHandled:true }` | Logs `sent` + `channel='manual'`; dequeues. `404` on unknown template/reservation. |
| GET | `/api/emails/history` | — | rows now include `channel` | Unchanged shape otherwise. |

---

## 5. Data model

- `email_log` gains **`channel TEXT NOT NULL DEFAULT 'smtp'`** (idempotent `ADD COLUMN`). Existing rows
  default to `'smtp'` (they were SMTP-sent / skipped). No CHECK change (status stays `'sent'`).

**Data impact:** additive column; no row loss. Historical `sent` rows are treated as SMTP, which matches
reality.

## 6. UI / UX

**"Emails à envoyer" rows:** a third action **« Marquer comme envoyé »** (text button, like « Ignorer »).
Order: row click = aperçu & envoi (SMTP); then **« Marquer comme envoyé »**, then **« Ignorer »**. On
`xs`, the action buttons wrap under the row content (the table already scrolls horizontally in its
container).

**History page:** the status cell shows **« Envoyé manuellement »** (info/neutral badge) for
`channel='manual'`, vs the existing **« Envoyé »** (success) for SMTP. Failed / Ignoré unchanged.

**Copy:** button « Marquer comme envoyé » ; badge « Envoyé manuellement ». A light confirmation dialog
(same pattern as the existing « Ignorer » action) guards against mis-clicks.

**Responsive:** no new layout; existing pending table + history table behavior.

## 7. Test plan

### Server unit tests (in `email-manual-queue.unit.test.js`, +5)
- [x] `markSent` logs `status='sent'` + `channel='manual'`, removes the pair from `email_manual_queue`,
  and the pair then disappears from `pending()`.
- [x] `markSent` idempotent: a 2nd call returns `alreadyHandled`, no duplicate row; still dequeues.
- [x] `markSent` works when the client has no email (no recipient required).
- [x] `send()` (SMTP) logs `channel='smtp'`; `history()` returns `channel`.
- [x] Existing email tests green (new column defaulted to `'smtp'` in all test DDLs); full suite 1449.

### Manual UI verification
- [ ] Mark a pending email as sent → leaves the queue, appears in history as « Envoyé manuellement ».
- [ ] A real SMTP send still appears as « Envoyé ».
- [ ] Mark an email for a client with no address → works (no error).
- [ ] Regression: « Ignorer » still logs `acknowledged-skip`; J-7/J-1 candidates still queue.

## 8. Out of scope

- Editing the rendered body before marking (marking is a one-click record; use send for content control).
- A bulk "mark all as sent".
- Tracking *which* external platform was used (Airbnb vs Booking) — only `manual` vs `smtp`.
- Un-marking / reverting a history entry.

## 9. Open questions

Resolved during scoping (2026-06-12):
- **Distinguish from SMTP sends in history?** → Yes: new `channel` column + « Envoyé manuellement » badge.
