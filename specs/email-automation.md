# Client emails — templates, scheduled send + manual review

| Field | Value |
|---|---|
| **Status** | Approved |
| **Branch** | `feature/email-automation` _(Claude-managed)_ |
| **Created** | 2026-06-07 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

GuestFlow already ships full SMTP infrastructure (settings UI in `/settings`,
[`settingsModel.decryptedSmtpSettings()`](../server/src/models/settingsModel.js),
[`utils/emailService.js`](../server/src/utils/emailService.js) wrapping `nodemailer`,
plain-text body helpers in [`utils/emailTemplates.js`](../server/src/utils/emailTemplates.js)).
The only thing it sends today is the admin "welcome / password-reset" email — there is **no
mechanism to communicate with future guests** at scheduled times (arrival reminders,
deposit reminders, post-stay messages…).

Operators currently send those emails by hand from their own mailbox, copy-pasting the
reservation details. The risk: forgotten reminders, inconsistent tone, missed customer
questions on arrival logistics.

**This PR reuses the existing SMTP path.** Every email — manual, scheduled, or default-
seeded — goes through the same `emailService.send({ to, subject, text })` call site that
the admin account flow already uses. Same `From:` (the configured `smtpFromName` + `smtpFromEmail`),
same encrypted password, same `EMAIL_NOT_CONFIGURED` handling. No new SMTP plumbing.

## 2. Goal

The operator can:
- Compose & manage a library of plain-text email templates with variables drawn from the
  reservation / client / property / financial data + conditional blocks (bed-linen
  configuration, caution check reminder…).
- Pick a **send mode** per template: `auto` (a scheduled task ships it on the matching day)
  or `manual` (the dashboard flags it as pending and the operator reviews + sends each
  one before it goes out).
- See pending manual emails as a dashboard notification (count + link to a review page) and
  acknowledge / send them.
- Trigger an email from a reservation page on demand (preview, optionally tweak the body,
  send).
- Browse the history of every email sent / acknowledged / failed.
- Find at least one useful template pre-seeded out of the box: a J-7 arrival reminder.

## 3. Functional rules

1. **Templates table.** Each template has: `id`, `name` (operator-facing label), `subject`,
   `body` (plain text with variables + conditional blocks), `dayOffset` (signed integer:
   `-7` = 7 days before `startDate`, `+1` = 1 day after, `0` = day of arrival),
   `sendMode` (`'auto'` | `'manual'`), `enabled` (boolean), `createdAt`, `updatedAt`.
2. **Send mode semantics.**
   - `auto` → the daily scheduled task sends the email automatically when a reservation
     matches the offset day. The send is then logged.
   - `manual` → the daily task does NOT send. Instead, the template + reservation pair is
     listed on the **dashboard pending email widget** with a count badge; the operator
     reviews + sends (or dismisses) each one explicitly.
3. **Variables.** The renderer substitutes `{{token}}` references inside subject + body.
   Supported tokens (see §4.4 for the exhaustive list):
   - Client: `clientFirstName`, `clientLastName`, `clientFullName`, `clientEmail`,
     `clientPhone`, `clientAddress`.
   - Reservation: `startDate`, `endDate`, `checkInTime`, `checkOutTime`, `nights`,
     `adultsCount`, `childrenCount`, `teensCount`, `babiesCount`, `totalGuests`.
   - Property: `propertyName`, `propertyAddress`.
   - Financial: `finalPrice`, `depositAmount`, `depositDueDate`, `balanceAmount`,
     `balanceDueDate`, `cautionAmount`.
   - Lists: `optionsList` (comma-separated titles of selected options), `bedConfig`
     (e.g. `"1 lit double, 2 lits simples, 1 lit bébé"`, omitting zero counts).
   - Company: `companyName`, `companyPhone`, `companyEmail`.

   A missing / empty variable renders as the empty string (fail-safe — never leaks a
   `{{varName}}` token to the recipient).
4. **Conditional blocks.** Supported syntax:
   - `{{#if hasBedLinenOption}}…{{/if}}` — present when the reservation has the bed-linen
     option ticked (any `reservation_options` row whose option `autoOptionType =
     'bed_linen'`).
   - `{{#if cautionNotBanked}}…{{/if}}` — present when no bank deposit was made (the
     existing `depositPaid = 0` reservation flag covers this; see §4.4 for the mapping).
   - `{{#if hasOptions}}…{{/if}}` — present when the reservation has at least one option.
   - `{{else}}` is supported inside any `{{#if}}…{{/if}}` block.
   - Nested conditions are **out of scope**: the parser only handles one level. Keeps the
     renderer ~30 lines instead of a half-handlebars engine.
5. **Date formatting in variables.** Dates render in French locale (`dd MMMM yyyy`, e.g.
   `15 juin 2026`) via a small helper. Times render `HH:mm`. Money renders `123,45 €`
   (reuses `formatCurrency` from `utils/devisHelpers.js`).
6. **Default templates via a file-based registry.** A single source file
   `utils/defaultEmailTemplatesRegistry.js` exports an array of default-template
   definitions. Each entry is a self-contained object:
   ```js
   {
     stableKey: 'arrival_reminder_7d',   // unique, stable across boots — the seed key
     name:      'Rappel arrivée — J-7',
     subject:   'Préparation de votre séjour à {{propertyName}}',
     body:      `... warm + professional plain text with {{tokens}} and {{#if}} blocks ...`,
     dayOffset: -7,
     sendMode:  'manual',                 // 'auto' or 'manual'
     enabled:   true,
   }
   ```
   On boot, `utils/defaultEmailTemplatesSeed.js` iterates the registry; for each entry, it
   INSERTs iff no row with that `stableKey` already exists. The seed never overwrites
   operator edits — once a row is inserted, its body / subject / enabled flag stay under
   operator control.

   **Adding a new default template = one file change.** A future ask like "add a J-1
   email that reminds the access codes" means: append one object to the registry +
   one test case asserting the seed inserts it. No DB migration, no controller change.
   This is the explicit design goal so AI-assisted additions stay trivial.

   **The PR ships exactly one default template** (the J-7 arrival reminder). The registry
   structure invites more to land in follow-up PRs.
7. **Scheduled cron task.** Runs every day at **08:00 server-local time**. For each
   enabled `auto` template + every reservation whose effective offset day matches today
   (`reservation.startDate + template.dayOffset === today`), the task:
   1. Looks up `email_log` for that `(templateId, reservationId)` pair.
   2. Skips if a row already exists with `status='sent'`.
   3. Renders + sends; logs success with the rendered subject/body for audit.
   4. On SMTP failure, logs `status='failed'` with the error message. The cron retries on
      the next day (the same reservation may still match if the offset day is in the
      future; otherwise the row is left as a failed audit trail and surfaces in the
      history).
8. **Dashboard pending list.** Single query: `enabled` manual templates × reservations
   whose `startDate + dayOffset` is **today or earlier in the past 7 days** (so a
   forgotten send from 3 days ago still surfaces), minus any pair already in `email_log`
   with `status IN ('sent', 'acknowledged-skip')`. Sorted by `startDate ASC` so the most
   imminent stay floats to the top.
9. **Acknowledge.** A pending entry can be:
   - **Sent** → POST `/api/emails/send` → logs `status='sent'`. Drops out of the pending
     list.
   - **Dismissed** → POST `/api/emails/pending/:templateId/:reservationId/acknowledge` →
     logs `status='acknowledged-skip'`. Also drops out. Useful when the operator already
     contacted the guest by other means.
10. **Manual send from a reservation page.** A new action in the `ReservationPage` action
    bar (NOT visible in devis mode): `"Envoyer un email"` opens a dialog that:
    - Lists every enabled template (sorted by `dayOffset` ASC), with the `name` + the
      computed target date for the current reservation (e.g. `"J-7 — envoi prévu le 8 juin
      2026"`).
    - On select → preview rendered subject + body + recipient.
    - Editable text area (the operator can tweak the body before sending; edits NOT saved
      to the template).
    - Send button.
11. **History page.** A new sidebar entry `Emails → Historique` lists every row of
    `email_log` (most recent first), with: sent date/time, template name, reservation
    (clickable → reservation page), status badge, subject. Per-row "view" opens a dialog
    with the full rendered body.
12. **EMAIL_NOT_CONFIGURED handling.** When SMTP isn't configured, all SEND endpoints
    return `409 EMAIL_NOT_CONFIGURED` and the dashboard widget shows a banner pointing
    to `/settings/smtp`. Pending list still works (operator can see the queue building
    up). The scheduled task does nothing if SMTP is not configured — every `auto` send
    that would have fired logs `status='failed'` with `errorMessage='EMAIL_NOT_CONFIGURED'`
    so the operator sees a visible trace.

**Edge cases:**
- **Reservation cancelled before send day.** Cancelled reservations are out of scope —
  GuestFlow doesn't carry a `cancelled` flag on the `reservations` row today. We send
  to every non-devis reservation; if Adrien later adds a cancellation column, the cron
  query filter is a one-line change.
- **Devis (`kind='devis'`) are excluded.** The whole feature operates on
  `reservations` rows where `kind = 'reservation'`. A devis hasn't been confirmed yet —
  no email is owed.
- **Client without an email.** Cron + manual send both surface a clear "no email on file"
  error (404 on send, badge `"Adresse manquante"` in the pending list).
- **Template body using an unknown variable.** Replaced with empty string. Documented in
  the rule above; the help text under the body field warns about it.
- **Template containing a malformed `{{#if … }}` block.** Renderer logs a warning,
  passes the malformed block through verbatim (so the operator sees what's broken in
  the preview before sending).

---

## 4. Architecture

> **Fat backend, thin frontend.** All template rendering, context computation,
> scheduling, conditional evaluation and SMTP dispatch live on the server. The frontend
> shows ready-to-render previews + lists.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `emailTemplates.js` | C | NEW. Thin: CRUD endpoints on `/api/email-templates`. |
| `routes/` | `emails.js` | C | NEW. Thin: `/api/emails/{preview,send,pending,acknowledge,history}`. |
| `controllers/` | `emailTemplatesController.js` | C | NEW. Validates payload (sendMode enum, dayOffset range -90..+90, subject/body required, name unique). Surfaces `400` / `404`. |
| `controllers/` | `emailsController.js` | C | NEW. Orchestrates: preview (renderer), send (renderer → emailService.send → emailLogModel.insert), pending (model), acknowledge, history. Surfaces `409 EMAIL_NOT_CONFIGURED`, `404 RESERVATION_NOT_FOUND`, `404 CLIENT_NO_EMAIL`. |
| `models/` | `emailTemplatesModel.js` | C | NEW. CRUD on `email_templates` + a `listEnabled()` helper for the cron. |
| `models/` | `emailLogModel.js` | C | NEW. Insert (sent/failed/acknowledged), `existsFor(templateId, reservationId, statuses[])`, pagination, joins for the history view (template + reservation summary). |
| `utils/` | `emailTemplateRenderer.js` | C | NEW. Pure functions: `renderTemplate(template, context)` (variables + conditionals → `{ subject, body }`). Fail-safe on missing variables; warn on malformed blocks. |
| `utils/` | `emailContextBuilder.js` | C | NEW. Pure functions: `buildContext({ reservation, client, property, options, settings })` → a flat context object the renderer consumes. Computes derived fields (`nights`, `bedConfig`, `optionsList`, `hasBedLinenOption`, `cautionNotBanked`, …). |
| `utils/` | `defaultEmailTemplatesRegistry.js` | C | NEW. Exports a `DEFAULT_TEMPLATES` array — each entry is the full self-contained shape (`stableKey`, `name`, `subject`, `body`, `dayOffset`, `sendMode`, `enabled`). Adding a default = appending one object here. |
| `utils/` | `defaultEmailTemplatesSeed.js` | C | NEW. Iterates the registry; for each entry, INSERTs into `email_templates` iff no row with that `stableKey` exists. Idempotent + non-destructive (operator edits survive). |
| `utils/` | `dateFr.js` | C | NEW. `formatDateLong(iso)` → `15 juin 2026`; `formatTimeShort(time)` → `HH:mm`. Tiny pure helpers, reused by the context builder. |
| `scheduledTasks.js` | `scheduledTasks.js` | T | Adds a daily-08:00 cron that runs the auto-send pass. Lives next to the existing iCal sync cron. |
| `database.js` | `database.js` | T | Idempotent CREATE TABLE for `email_templates` + `email_log`. Calls `defaultEmailTemplatesSeed` at boot. |

**Notes:**
- Routes stay thin. The controller does no SQL.
- Renderer + context builder are pure → 100% unit-testable without a DB.
- **Single SMTP path** (rule 0 of this PR): the new controllers funnel through the existing
  `emailService.send({ to, subject, text })` — no new nodemailer call sites, no new SMTP
  settings, no duplicate `From:` config. The admin "first connection" email and a J-7
  guest reminder ride the same transport.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `EmailTemplatesPage.js` | C | NEW. List + create/edit dialog. Variable + condition picker buttons that insert the token at the cursor. Validation hooks. |
| `pages/` | `EmailHistoryPage.js` | C | NEW. Paginated list of `email_log` rows with filters (status, template, reservation search). |
| `pages/` | `ReservationPage.js` | T | New `"Envoyer un email"` action in `actionBarBefore` (only when `!isDevisMode` AND client has email). Opens `EmailManualSendDialog`. |
| `pages/` | `DashboardPage.js` | T | New widget "Emails à vérifier" — count + link to the EmailPendingDialog. Hidden when count = 0. |
| `components/` | `EmailManualSendDialog.js` | C | NEW. Template picker → preview (editable text area) → send. Also used when an operator clicks "Envoyer" from the pending list. |
| `components/` | `EmailPendingDialog.js` | C | NEW. Lists the pending manual emails; rows have `Voir & envoyer` (opens `EmailManualSendDialog`) and `Ignorer` (acknowledge). |
| `components/` | `EmailLogViewDialog.js` | C | NEW. Read-only modal that shows the rendered subject + body for a historical row. |
| `components/` | `Sidebar.js` (or equivalent) | T | Adds an `Emails` group with two sub-items: `Modèles`, `Historique`. |
| `api.js` | `api.js` | T | Adds helpers: `getEmailTemplates`, `createEmailTemplate`, `updateEmailTemplate`, `deleteEmailTemplate`, `previewEmail({reservationId, templateId})`, `sendEmail({reservationId, templateId, overrides?})`, `getPendingEmails`, `acknowledgePendingEmail`, `getEmailHistory`. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `FormDialog`, `ConfirmDialog`, `DataPageScaffold`, `TableCard` | Reused as-is for the templates / history pages. |
| **Created (new generic)** | (none planned) | The 3 new dialogs are tightly coupled to the email domain; if a similar "render preview + send" pattern appears later (e.g. SMS), extract then. |

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/email-templates` | — | `[{ id, stableKey, name, subject, body, dayOffset, sendMode, enabled, createdAt, updatedAt }]` | Sorted by `dayOffset ASC, name ASC`. `stableKey` is non-null only for templates that came from the registry. |
| GET | `/api/email-templates/:id` | — | template row | `404` if missing. |
| POST | `/api/email-templates` | `{ name, subject, body, dayOffset, sendMode, enabled }` | created row | `400` on invalid payload (sendMode not in enum, dayOffset out of range, missing fields). The `stableKey` is **NOT writable via HTTP** — it's controlled by the registry seed alone. |
| PUT | `/api/email-templates/:id` | same shape (NO `stableKey`) | updated row | `400` / `404`. A `stableKey` in the payload is silently ignored — only the registry seed can set it. |
| DELETE | `/api/email-templates/:id` | — | `{ ok }` | `404` if missing. The `email_log` rows survive (FK is nullable on delete; we keep history intact). |
| GET | `/api/emails/preview?reservationId=N&templateId=M` | — | `{ to, subject, body, missingVariables: [] }` | Renders against the live reservation context. `404` if reservation/template missing. |
| POST | `/api/emails/send` | `{ reservationId, templateId, overrides?: { subject?, body? } }` | `{ ok, emailLogId, sentAt }` | `409 EMAIL_NOT_CONFIGURED`, `404 RESERVATION_NOT_FOUND`, `404 CLIENT_NO_EMAIL`. |
| GET | `/api/emails/pending` | — | `[{ templateId, reservationId, templateName, clientFullName, clientEmail, propertyName, startDate, sendDate, hasClientEmail }]` | Sorted `startDate ASC`. See §3 rule 8 for the join. |
| POST | `/api/emails/pending/:templateId/:reservationId/acknowledge` | — | `{ ok }` | Logs an `acknowledged-skip` row. |
| GET | `/api/emails/history?limit=&offset=&reservationId=&templateId=&status=` | — | `{ rows: […], total }` | Paginated. |

Auth: all under the existing global `requireAuth` (same as every other private endpoint).

### 4.4 Full context tokens

The context builder produces the following flat object — the renderer accepts only these
keys; everything else passes through as empty string.

| Token | Source | Format |
|---|---|---|
| `clientFirstName` | `clients.firstName` | string |
| `clientLastName` | `clients.lastName` | string |
| `clientFullName` | `${firstName} ${lastName}` trimmed | string |
| `clientEmail` | `clients.email` | string |
| `clientPhone` | `clients.phone` | string |
| `clientAddress` | concat of `streetNumber` + `street` + `postalCode` + `city` | string |
| `startDate` | `reservations.startDate` | `dd MMMM yyyy` (FR locale) |
| `endDate` | `reservations.endDate` | same |
| `checkInTime` | `reservations.checkInTime` ⇢ fallback `property.defaultCheckIn` | `HH:mm` |
| `checkOutTime` | `reservations.checkOutTime` ⇢ fallback `property.defaultCheckOut` | `HH:mm` |
| `nights` | `diffDays(start, end)` | integer |
| `adultsCount` / `teensCount` / `childrenCount` / `babiesCount` | reservation columns | integers |
| `totalGuests` | sum of adults+teens+children+babies | integer |
| `propertyName` | `properties.name` | string |
| `propertyAddress` | TBD (property addresses aren't stored today) | empty string for now, populated when the column lands |
| `finalPrice` | `reservations.finalPrice` | `123,45 €` |
| `depositAmount` | `reservations.depositAmount` | same |
| `depositDueDate` | `reservations.depositDueDate` | FR date |
| `balanceAmount` | `reservations.balanceAmount` | same |
| `balanceDueDate` | `reservations.balanceDueDate` | FR date |
| `cautionAmount` | `reservations.cautionAmount` | same |
| `optionsList` | sorted by option title, comma-separated; empty string when no options | string |
| `bedConfig` | aggregates `singleBeds`, `doubleBeds`, `babyBeds`; e.g. `"1 lit double, 2 lits simples"`; omits zero counts; empty when all zero | string |
| `companyName` / `companyPhone` / `companyEmail` | `app_settings` | strings |

Booleans for conditional blocks:

| Boolean | Truthy when |
|---|---|
| `hasBedLinenOption` | At least one `reservation_options` row whose linked option has `autoOptionType = 'bed_linen'`. |
| `cautionNotBanked` | `reservation.cautionAmount > 0` AND `reservation.depositPaid != 1`. (Naming proxies the user request: "no bank deposit made yet"; revisit when a dedicated `cautionMethod` column lands.) |
| `hasOptions` | Any `reservation_options` row exists. |

---

## 5. Data model

Two new tables, both idempotent at boot.

```sql
CREATE TABLE IF NOT EXISTS email_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Stable key used by the file-based default-template seed to know "did I already insert
  -- this one?" across boots. NULL for operator-created templates (they have no seed key).
  -- UNIQUE so re-running the seed never creates a duplicate.
  stableKey TEXT UNIQUE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  dayOffset INTEGER NOT NULL,
  sendMode TEXT NOT NULL DEFAULT 'manual', -- 'auto' | 'manual'
  enabled INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now')),
  CHECK (sendMode IN ('auto', 'manual'))
);
CREATE INDEX IF NOT EXISTS idx_email_templates_enabled_offset
  ON email_templates(enabled, dayOffset);

CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  templateId INTEGER, -- nullable: a manually-edited one-off send has no template
  reservationId INTEGER NOT NULL,
  sentAt TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL, -- 'sent' | 'failed' | 'acknowledged-skip'
  errorMessage TEXT DEFAULT '',
  renderedSubject TEXT NOT NULL,
  renderedBody TEXT NOT NULL,
  recipientEmail TEXT NOT NULL DEFAULT '',
  CHECK (status IN ('sent', 'failed', 'acknowledged-skip'))
);
CREATE INDEX IF NOT EXISTS idx_email_log_reservation ON email_log(reservationId);
CREATE INDEX IF NOT EXISTS idx_email_log_status_sent ON email_log(status, sentAt DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_template_res ON email_log(templateId, reservationId);
```

**Why no UNIQUE constraint** on `(templateId, reservationId, status)`: the cron + manual
send + acknowledge flows all rely on the "any row with status='sent' wins" semantic, which
a simple `existsFor(templateId, reservationId, ['sent','acknowledged-skip'])` covers. A
failed send is allowed to coexist with a future successful retry — the history then carries
both rows, which is the audit trail the operator wants.

**Default-template seed (registry-driven):** `defaultEmailTemplatesSeed.js` iterates
`DEFAULT_TEMPLATES` from `defaultEmailTemplatesRegistry.js`. For each entry:

1. `SELECT id FROM email_templates WHERE stableKey = ?` — if a row already exists, skip
   (the operator may have edited the body / name / enabled flag — never overwrite).
2. Otherwise `INSERT INTO email_templates (stableKey, name, subject, body, dayOffset,
   sendMode, enabled) VALUES (...)`.

Re-runs on every boot are no-ops in steady state. Re-seeds a default if the operator
deleted it (the row with that stableKey is back).

**UI badges** mark the origin: rows with a non-null `stableKey` carry a small
`Modèle livré` chip in the list (so the operator knows they came with the app); deletable
like any other row, but re-seed on the next boot.

**Data impact:** Two new tables; nothing else touched. Idempotent at boot, additive only.
Documented as a `Migration` note in `CHANGELOG.md`.

## 6. UI / UX

### 6.1 `EmailTemplatesPage` (`/emails/modeles`)

`DataPageScaffold` shape, list view:

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Modèles d'emails                                [+ Nouveau modèle]      │
├──────────────────────────────────────────────────────────────────────────┤
│ Nom                            Quand        Mode      Activé             │
├──────────────────────────────────────────────────────────────────────────┤
│ Rappel arrivée — J-7  [Livré]  J-7          [Manuel]  [✓]   [✎][🗑]   │
│ Bienvenue le jour J            J            [Auto]    [✓]   [✎][🗑]   │
└──────────────────────────────────────────────────────────────────────────┘
```

A `[Livré]` chip (`Modèle livré`) is rendered when `template.stableKey != null` so the
operator can tell registry-seeded templates from their own creations. Both kinds are fully
editable + deletable (a deleted registry template re-seeds on next boot).

Edit dialog:

```
Nom            [ Rappel arrivée — J-7                                  ]
Quand envoyer  [ -7 ] jours par rapport au début de séjour
                  ↳ Négatif = avant; positif = après; 0 = jour J.
Mode d'envoi   ( • Manuel  ○ Automatique )
Activé         [✓]

Sujet          [ Préparation de votre séjour à {{propertyName}}         ]

Corps          ┌──────────────────────────────────────────────────────┐
               │ Bonjour {{clientFirstName}},                          │
               │                                                       │
               │ Nous préparons votre séjour à {{propertyName}}.       │
               │ […]                                                   │
               └──────────────────────────────────────────────────────┘

       Variables : [Nom] [Prénom] [Logement] [Arrivée] [Départ] …
       Conditions : [Si linge de lit] [Si caution non encaissée] [Sinon] [Fin si]
```

Buttons under the body insert the token at the current cursor position. A short helper
text reminds the operator that an unknown variable renders empty.

### 6.2 Dashboard pending email widget (`DashboardPage`)

```
┌─────────────────────────────────────────────┐
│ ✉  Emails à vérifier — 3                    │
│    3 messages à envoyer pour ces 7 derniers │
│    jours.                                    │
│    [Voir et envoyer]                         │
└─────────────────────────────────────────────┘
```

Hidden entirely when the count is 0. Clicking opens `EmailPendingDialog`.

### 6.3 `EmailPendingDialog`

```
Emails en attente d'envoi

┌────────────────────────────────────────────────────────────────────────┐
│ Client          Logement       Séjour          Modèle            Actions│
├────────────────────────────────────────────────────────────────────────┤
│ Jean Dupont     Villa A        14-17 juin      Rappel arrivée    [Voir & envoyer] [Ignorer]│
│ Sophie Martin   Le Gîte        15-19 juin      Rappel arrivée    [Voir & envoyer] [Ignorer]│
└────────────────────────────────────────────────────────────────────────┘
                                                    [Fermer]
```

- "Voir & envoyer" → `EmailManualSendDialog`.
- "Ignorer" → confirm dialog → POST acknowledge.

### 6.4 `EmailManualSendDialog`

When opened from a reservation page (action bar) or from the pending list:

```
Envoyer un email — Jean Dupont (jean@dupont.fr)

Modèle    [ Rappel arrivée — J-7              ▾ ]
Sujet     [ Préparation de votre séjour à Villa A          ]

Corps     ┌──────────────────────────────────────────────┐
          │ Bonjour Jean,                                 │
          │                                               │
          │ Nous préparons votre séjour à Villa A …      │
          │ […]                                           │
          └──────────────────────────────────────────────┘

Variables manquantes : aucune
                                              [Annuler] [Envoyer]
```

Subject + body are editable before send (free-form tweak; not persisted to the template).

### 6.5 `EmailHistoryPage` (`/emails/historique`)

`DataPageScaffold`, paginated list:

```
Historique des emails

Filtres : [Modèle ▾] [Statut ▾] [Réservation 🔍]

┌────────────────────────────────────────────────────────────────────────┐
│ Date / heure       Modèle             Destinataire    Statut    Sujet │
├────────────────────────────────────────────────────────────────────────┤
│ 07/06/2026 08:00   Rappel arrivée    jean@…           ✓ Envoyé  Préparation…│
│ 06/06/2026 08:00   Bienvenue         marc@…           ✗ Échec   …            │
└────────────────────────────────────────────────────────────────────────┘
                                                  Prev / Next
```

Click on a row → `EmailLogViewDialog` (read-only preview with rendered subject + body +
the error message if status=`failed`).

### 6.6 `ReservationPage` action bar (reservation mode only)

A new icon button "Envoyer un email" (`MailOutline`) between the existing actions.
Hidden when the client has no email address; disabled with a tooltip when SMTP isn't
configured.

### 6.7 Sidebar

```
[…]
✉  Emails
   ├ Modèles
   └ Historique
```

### 6.8 Responsive

- `EmailTemplatesPage`, `EmailHistoryPage`: existing `DataPageScaffold` already
  responsive. On `xs`, table → stacked cards via the scaffold default behaviour.
- All dialogs use `FormDialog` with `fullScreen={isMobile}`.
- Body text area: `minRows={8}` on `md+`, `minRows={12}` on `xs` (more vertical real
  estate when the keyboard is up).
- Variable / condition picker chips wrap to multiple rows on narrow screens.

### 6.9 Sticky action bar

- `EmailTemplatesPage`: `<PageActionBar title="Modèles d'emails" />` with a `+` action.
- `EmailHistoryPage`: `<PageActionBar title="Historique des emails" />`, no save action
  (read-only).

---

## 7. Test plan

### Server unit tests (target ~25 new cases)

- [ ] `tests/email-template-renderer.unit.test.js` — variable substitution (multi-token,
      missing, repeated); conditional `{{#if}}…{{/if}}`; `{{else}}` branch; nested blocks
      pass-through warning; malformed `{{#if}}` left verbatim; subject + body both
      rendered.
- [ ] `tests/email-context-builder.unit.test.js` — `nights`, `totalGuests`, `bedConfig`
      formatting (omits zero counts), `optionsList` sort, `hasBedLinenOption` truthy/falsy,
      `cautionNotBanked` truthy/falsy, missing client email → empty string + flag.
- [ ] `tests/date-fr.unit.test.js` — `formatDateLong('2026-06-15')` → `'15 juin 2026'`;
      empty → `''`; malformed → `''`.
- [ ] `tests/default-email-templates-seed.unit.test.js` — fresh DB seeds every registry
      entry (currently one); pre-existing rows with matching `stableKey` are skipped;
      operator edits to a registry row are NEVER overwritten by re-seeding; a deleted
      registry row gets re-inserted on next boot; idempotent on consecutive runs.
- [ ] `tests/default-email-templates-registry.unit.test.js` — every registry entry has
      a non-empty `stableKey` + unique across the array; each entry's `subject` + `body`
      reference at least one supported variable (lint-ish check to catch typos).
- [ ] `tests/email-templates-model.unit.test.js` — CRUD; `listEnabled()` returns
      `enabled=1` only.
- [ ] `tests/email-templates-controller.unit.test.js` — `400` on bad sendMode / out-of-range
      dayOffset / missing subject / missing body; `404` on missing id; happy paths.
- [ ] `tests/email-log-model.unit.test.js` — insert; `existsFor` matches by status set;
      pagination; history filters.
- [ ] `tests/emails-controller.unit.test.js` — preview shapes; send happy path (mocked
      `emailService.send`); send returns `409 EMAIL_NOT_CONFIGURED`; send returns `404
      CLIENT_NO_EMAIL`; acknowledge logs an `acknowledged-skip` row; pending join
      filters out already-sent + already-acknowledged pairs.
- [ ] `tests/email-scheduled-task.unit.test.js` — cron pass: sends every `auto` matched
      reservation; skips already-sent pairs; logs failures; ignores `manual` templates;
      ignores devis (`kind='devis'`).
- [ ] Full server suite stays green.

### Client tests (Vitest, target ~12 new cases)

- [ ] `client/src/pages/__tests__/EmailTemplatesPage.test.js` — list renders;
      create-dialog validation (empty subject → submit disabled); variable picker
      inserts the token at cursor.
- [ ] `client/src/components/__tests__/EmailManualSendDialog.test.js` — preview reflects
      template; editable subject + body bound to local state; send calls `api.sendEmail`
      with overrides; preview shows missing variables when any.
- [ ] `client/src/components/__tests__/EmailPendingDialog.test.js` — empty state hides
      the widget; rows render; "Ignorer" calls `api.acknowledgePendingEmail`.
- [ ] `client/src/pages/__tests__/DashboardPage.email-widget.test.js` — widget hidden
      when count = 0; shows count + button when count > 0; clicking opens
      EmailPendingDialog.

### Manual UI verification (after Commit 2)

- [ ] Configure SMTP in `/settings`. Send a test email. Confirm reception.
- [ ] Create a reservation with a client email + the bed-linen option ticked + caution
      unpaid. Set its start date to today+7. Open the new "Envoyer un email" action →
      preview shows `bedConfig` block + caution reminder. Send → email arrives.
- [ ] Same reservation without bed-linen option → preview omits the bed-config block.
- [ ] Same reservation with `depositPaid = 1` → preview omits the caution reminder.
- [ ] Default template seed: drop the table and reboot — exactly one template seeded.
- [ ] Pending list flow: set a reservation's start date so today is J-7. Restart cron
      manually (or wait for 8 AM). Confirm the manual template flagged it. Acknowledge
      one → drops out. Send another → drops out.
- [ ] Mobile breakpoint: every dialog stacks readably.

## 8. Out of scope

- **Bilingual emails** (FR only). The body is plain text; the operator can hand-translate
  if needed.
- **HTML bodies / inline images / PDF attachments.** Plain text only (matches the existing
  `emailService.send` signature).
- **Cancellation handling.** GuestFlow doesn't carry a cancelled flag today; the cron
  doesn't skip cancelled stays.
- **Email open / click tracking.** No tracking pixels, no link rewriting.
- **Per-property templates.** One global library; the operator can encode property
  specifics in the body via `{{propertyName}}` etc.
- **Retry on transient SMTP failure.** A `failed` row stays as an audit trail; the
  operator re-sends manually if needed.
- **Recurring / event-based triggers other than `startDate ± N days`.** No "send when
  status changes", no "send when deposit paid", etc.
- **In-app AI prompt to draft a template.** No live LLM call from inside GuestFlow for
  this PR — that would mean an API key in `app_settings`, encryption, rate limiting, a
  prompt UI, and graceful error handling, all of which is a feature of its own. The
  AI-friendly entry point is instead the **registry file** (§3 rule 6): when Adrien asks
  Claude in chat to "add a J-1 access-codes reminder", Claude appends one object to
  `defaultEmailTemplatesRegistry.js` + one unit case. Single source file, no DB
  migration, no controller change.

## 9. Open questions

(Resolved during scope discussion 2026-06-07.)

- Q: Multi-template or single template?
  - A: Multi. CRUD on `/emails/modeles`.
- Q: FR or bilingual?
  - A: FR only for this PR. Bilingual is a future PR if foreign-client volume grows.
- Q: Auto, manual, or both?
  - A: Both. Per-template `sendMode` flag. Manual templates surface as a dashboard
    notification with an acknowledge mechanism. Adrien explicitly wanted this hybrid.
- Q: SMTP — new transport for guest emails, or reuse the existing admin one?
  - A: **Reuse** (decided 2026-06-07). Single `emailService.send()` + single SMTP
    config from `app_settings`. Same `From:` as the admin "first connection" email.
- Q: How does Adrien add automated emails "via an AI prompt"?
  - A: Registry-based (decided 2026-06-07). A file
    `utils/defaultEmailTemplatesRegistry.js` holds every shipped default template as
    a self-contained object. Adding a new one = appending an object + a one-line test
    case. This keeps AI-assisted additions to one source file change. An in-app LLM
    integration is explicitly out of scope (see §8).

Remaining unresolved:
- Q: Should the "Envoyer un email" action on the reservation page also let the operator
  pick a recipient other than the client email (e.g. an internal owner address)?
  - A: Deferred. Today the recipient is always the client email. If a co-host scenario
    appears, add a small recipient override field in the manual send dialog.
