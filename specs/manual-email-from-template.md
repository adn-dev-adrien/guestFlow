# Manual email from template (queue a send on demand)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/manual-email-from-template` _(user-managed)_ |
| **Created** | 2026-06-12 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The "Emails à envoyer" queue on Paramètres → Emails (`/emails`) is **derived, not stored**:
`emailLogModel.listPending` returns every *enabled, manual* template × every reservation whose
`startDate + dayOffset` falls inside a date window `[today − lookbackDays, today]`, minus any pair that
already has a `sent` / `acknowledged-skip` row in `email_log`. The whole send pipeline (preview, send,
acknowledge, cron) is keyed on the bare pair `(templateId, reservationId)` and re-renders from the live
template + reservation.

There is **no way to put an email into that queue on demand**: the operator can only wait for a
reservation to enter a template's date window. They want to **compose an email from any template for any
reservation, right now**, and have it land in "Emails à envoyer" for review + send — independent of the
date window.

## 2. Goal

From Paramètres → Emails, the operator can **create an email**: pick a reservation, pick a template, and
the (template, reservation) pair immediately appears in "Emails à envoyer", where it is previewed and sent
through the existing flow.

## 3. Functional rules

1. A **"Créer un email"** action on `/emails` opens a dialog with two steps: (a) choose a **reservation**,
   (b) choose a **template**.
2. The reservation picker lists **all** reservations (`kind='reservation'`), most recent / upcoming first,
   **searchable by client name** (also matches property name). Each option shows client name, property,
   and stay dates.
3. The template picker lists the existing templates (the same list shown on the page).
4. On confirm, the pair is **persisted** in a manual queue and appears in "Emails à envoyer"
   **immediately**, regardless of the template's `dayOffset` / date window.
5. **Already-sent guard:** if that template was already **sent** for that reservation, confirming does
   **not** queue silently. The server reports `alreadySent` + the **last send date**; the UI warns the
   operator ("Ce mail a déjà été envoyé le …") and offers **Recréer** (queue it anyway) or **Annuler**.
   `acknowledged-skip` history does **not** trigger this warning (the operator deliberately skipped it).
6. A manually-queued pair is shown in the queue **even if previously sent/acknowledged** (rule 5 already
   gated the resend), i.e. it **bypasses** the `NOT EXISTS sent/acknowledged` filter that the date-driven
   candidates use. This is what makes a deliberate **renvoi** possible.
7. Sending a queued email (existing send flow) or acknowledging/skipping it **removes** it from the manual
   queue. The action is logged in `email_log` exactly as today (`sent` / `acknowledged-skip`).
8. **Dedup:** a pair that is *both* date-driven and manually queued shows as **one** row in the queue,
   flagged "Ajouté manuellement".
9. Creating a pair that is already queued is a **no-op** (idempotent), not an error.
10. All shaping (picker labels with French dates, last-send lookup, queue merge + dedup) is **server-side**.

**Edge cases:**
- Reservation or template deleted after queuing → the queue row is removed automatically (FK cascade).
- Client without an email on file → queuing still works; the missing-email is handled at **send** time by
  the existing "fix missing email" flow (unchanged).
- SMTP not configured → unchanged; surfaces at send time.
- A manually-queued email that is never sent **stays** in the queue until sent or skipped (intended).

---

## 4. Architecture

> **Fat backend, thin frontend.** The queue table, the merge with the derived list, the already-sent
> lookup, and all picker/label shaping live on the server. The client renders the dialog and the queue
> rows, holding only local dialog state.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` | `database.js` | T | Idempotent migration: create `email_manual_queue` (PK `(templateId, reservationId)`, `createdAt`, FK cascade to templates + reservations). |
| `models/` | `models/emailManualQueueModel.js` | C | `add(templateId, reservationId)` (INSERT OR IGNORE), `remove(templateId, reservationId)`, `list()` / `listEnriched(...)` joining templates × reservations × clients × properties + the most recent `sent` `lastSentAt` per pair. |
| `models/` | `models/emailLogModel.js` | T | Add `lastSentAt(templateId, reservationId)` (most recent `status='sent'` `sentAt`) for the already-sent guard + queue-row "déjà envoyé" note. `listPending` unchanged. |
| `models/` | `models/reservationsModel.js` (or a small query in the controller) | T | `listForEmailPicker({ q })` → compact rows `{ id, clientFullName, propertyName, startDate, endDate }`, `kind='reservation'`, ordered `startDate DESC`. |
| `controllers/` | `controllers/emailsController.js` | T | `pending()` merges date-driven `listPending` + manual-queue (deduped by pair, manual flag wins, date-driven still filtered by sent/ack, manual shown unconditionally). New `queue()` (POST, with `force`), `eligibleReservations()` (GET). `send()` + `acknowledge()` also `emailManualQueueModel.remove(pair)` so a sent/skipped item leaves the queue. |
| `routes/` | `routes/emails.js` | T | `GET /api/emails/eligible-reservations`, `POST /api/emails/queue`. Thin → controller. |
| `utils/` | `emailContextBuilder`, `emailTemplateRenderer` | REUSE | Rendering unchanged; preview/send still re-render from the live pair. |
| `scheduledTasks.js` | — | REUSE | Cron path untouched (it only handles `auto` templates; manual queue is operator-driven). |

**Notes:**
- The queue stores only the **pair** (+ `createdAt`); the email body is always re-rendered live at
  preview/send, so edits to the template or reservation are reflected — consistent with the current
  design (no stale snapshots in the queue).
- Routes stay thin; all logic in the controller/models.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `pages/EmailTemplatesPage.js` | T | "Créer un email" button (header); manages the create dialog state; on success → `reloadPending()`. Always render the queue card when there are queued items (today it's hidden when empty — keep, since a freshly-created email makes it non-empty). |
| `components/` | `components/EmailComposeDialog.js` | C | New generic-ish dialog: reservation Autocomplete (fed by `api.getEmailEligibleReservations`) + template Select; on confirm calls `api.queueEmail`; handles the `alreadySent` warning → Recréer/Annuler (via existing `ConfirmDialog`/`useAppDialogs`). |
| `components/` | `components/EmailPendingList.js` | T | Render an "Ajouté manuellement" chip when `row.manual`, and an optional "déjà envoyé le …" caption when `row.lastSentAt`. |
| `api.js` | `api.js` | T | `getEmailEligibleReservations(q)`, `queueEmail({ templateId, reservationId, force })`. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `FormDialog`, `ConfirmDialog` (`useAppDialogs`), `EmailPendingList`, `EmailManualSendDialog` (send step, unchanged) | Reused as-is. |
| **Created (new generic)** | `EmailComposeDialog` | Pick reservation + template → queue. Specific to the email feature but self-contained; kept in `components/` like the sibling `EmailManualSendDialog`. |
| **Specific (kept feature-local)** | — | — |

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/emails/eligible-reservations?q=` | — | `[{ id, clientFullName, propertyName, startDate, endDate }]` | All `kind='reservation'`, `startDate DESC`. `q` optional server filter on client/property name. |
| POST | `/api/emails/queue` | `{ templateId, reservationId, force? }` | `200 { ok:true, queued:true }` **or** `200 { ok:false, alreadySent:true, lastSentAt }` (when `!force` and a prior `sent` exists) | Idempotent; `force:true` queues despite prior send. `404 TEMPLATE_NOT_FOUND` / `RESERVATION_NOT_FOUND`. |
| GET | `/api/emails/pending` | — | rows now include optional `manual:true` + `lastSentAt` | Merged date-driven + manual-queue, deduped. |
| POST | `/api/emails/send` | unchanged | unchanged | Also removes the pair from the manual queue on success. |
| POST | `/api/emails/pending/:tid/:rid/acknowledge` | unchanged | unchanged | Also removes the pair from the manual queue. |

---

## 5. Data model

New table (idempotent block in `database.js`):

```sql
CREATE TABLE IF NOT EXISTS email_manual_queue (
  templateId    INTEGER NOT NULL,
  reservationId INTEGER NOT NULL,
  createdAt     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (templateId, reservationId),
  FOREIGN KEY (templateId)    REFERENCES email_templates(id) ON DELETE CASCADE,
  FOREIGN KEY (reservationId) REFERENCES reservations(id)    ON DELETE CASCADE
);
```

**Data impact:** purely additive — a new table, no change to existing rows. `email_log` /
`email_templates` / `reservations` schemas are untouched (only a new read helper `lastSentAt`).

## 6. UI / UX

**Page `/emails`:**
- A **"Créer un email"** button (contained, `AddIcon`) in the page header, beside "Historique des envois".
  On `xs` it goes full-width (matches the existing header buttons).
- The **queue card** ("Emails à envoyer") already renders when non-empty; a freshly-created email makes it
  appear. Manual rows carry a small **"Ajouté manuellement"** chip; if a prior send exists, a muted
  caption **"déjà envoyé le {date}"**.

**`EmailComposeDialog`:**
- Title "Créer un email". Two fields:
  1. **Réservation** — MUI `Autocomplete`, options from `eligible-reservations`, option label
     `"{clientFullName} — {propertyName} — du {startDate} au {endDate}"` (French long dates from server).
     Searchable by typing the client name.
  2. **Modèle** — `Select` of templates (`name` + `J±n` chip).
- Actions: **Annuler** / **Ajouter à la file** (disabled until both chosen).
- **Already-sent path:** if the server returns `alreadySent`, a `ConfirmDialog` shows
  *"Ce mail (« {templateName} ») a déjà été envoyé le {lastSentAt} pour cette réservation. Le recréer
  quand même ?"* → **Recréer** (re-POST with `force:true`) / **Annuler**.
- On success: close, toast/snackbar "Email ajouté à la file", `reloadPending()`.
- **Responsive:** `fullScreen` on `xs` (`useMediaQuery(down('sm'))`), fields stack vertically; on `md+` a
  comfortable dialog width. Touch targets ≥44px (MUI defaults).
- **States:** loading while fetching reservations; empty → "Aucune réservation"; error → `ErrorAlert`
  with retry.

**Sticky action bar:** `EmailTemplatesPage` keeps its existing layout; "Créer un email" sits with the
page header actions (no change to `PageActionBar` contract).

## 7. Test plan

### Server unit tests

All consolidated in `tests/email-manual-queue.unit.test.js` (C, +17) — the queue model + the
controller's queue / pending-merge / dequeue / eligibleReservations:
- [x] model: `add` idempotent (PK), `remove`, `has`, `listEnriched` joins + `lastSentAt`.
- [x] `queue()` without `force` + prior `sent` → `alreadySent` + `lastSentAt`, not queued; with `force` →
  queued; no prior send → queued; unknown template/reservation → 404.
- [x] `pending()` merge: a manually-queued far-future pair shows despite the date window; a manual pair
  shows even when a `sent` log exists (resend); manual flag carried on the row.
- [x] a successful `send()` and an `acknowledge()` each remove the pair from `email_manual_queue`.
- [x] `eligibleReservations()` returns compact rows, `kind='reservation'` only, `q` filters by
  client/property name.
- [x] Existing email-controller + auto-send-runner suites updated (resources tables) and green.

### Manual UI verification
- [ ] Créer un email: pick a reservation + template → appears immediately in "Emails à envoyer" with the
  "Ajouté manuellement" chip; preview + send works; the row then disappears + shows in history.
- [ ] Already-sent: create the same pair again → warning with the correct date → Recréer re-queues →
  Annuler does nothing.
- [ ] Search the reservation picker by client name.
- [ ] Acknowledge a manually-created email → leaves the queue, logged as skip.
- [ ] Regression: the date-driven J-7 / J-1 candidates still appear and behave as before.
- [ ] Mobile (`xs`): dialog full-screen, fields stacked, button full-width.

## 8. Out of scope

- **Editing the template body inside the compose dialog** before queuing (the existing send dialog already
  allows per-send overrides at send time).
- **Server-side paginated reservation search** for very large datasets — v1 returns all reservations
  (compact) with optional `q`; an indexed/paged search is a later optimisation if the list grows large.
- Bulk-queuing (multiple reservations at once).
- Any change to the automatic (cron) `auto`-template path.

## 9. Open questions

Resolved during scoping (2026-06-12):
- **Already-sent behavior?** → Warn with the last send date; offer Recréer / Annuler (resend allowed).
- **Which reservations selectable?** → All, searchable by client name.
