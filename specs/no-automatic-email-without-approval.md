# No automatic email without the operator's approval

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/no-automatic-email-without-approval` |
| **Created** | 2026-08-20 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

GuestFlow can currently mail a guest with nobody in the loop. Two code paths do it:

1. **The 08:00 cron.** `scheduledTasks.tickEmailAutoSend` → `utils/emailAutoSendRunner.performAutoEmailPass`
   iterates every **enabled** template whose `sendMode = 'auto'`, matches it against the day's
   reservations (anchors `start`, `depositDueDate`, `balanceDueDate`), renders it and ships it over SMTP.
   There is **no global gate**: the pass runs on every install, every day.
2. **The online-payment confirmation.** `utils/paymentEffectDeps.buildPaymentEffectDeps` wires
   `sendConfirmation` = `reservationEmailSender.buildConfirmationSender(...)`, called by the Qonto
   webhook, the 15-minute poll cron and the on-demand status poll. The moment a payment confirms a
   stay, the « Confirmation de réservation » email leaves — no review, no queue.

The operator believed a settings flag already guarded this. It does not exist. The only email switch
in Réglages is *« Notifications de réservation »* (`SettingsNotificationsSection`), which governs the
mails GuestFlow sends **to the operator** (new website devis, new iCal reservation) — not guest mail.

Today the risk is latent rather than active: every template in `defaultEmailTemplatesRegistry` ships
as `manual`, and `utils/migratePaymentTemplatesToManual` forced the two dunning templates back to
`manual` after they shipped as `auto` by mistake. But nothing stops a template from being flipped to
« Automatique (envoi à 08:00) » in the Emails page — and the confirmation-on-payment path is
automatic *right now*, on every paid link.

This spec closes the gap for good: a guest email leaves GuestFlow only when the operator says so, or
when a settings flag explicitly authorises the automation.

## 2. Goal

No email addressed to a guest ever leaves GuestFlow without the operator's approval, unless an
explicit « autoriser l'envoi automatique » setting — off by default — has been turned on. Anything the
automation wanted to send lands in the existing « à valider » queue instead, ready to review and send
in one click.

## 3. Functional rules

1. A new global setting **`emailAutoSendEnabled`** governs every automatic guest email. It is
   **OFF by default**, on fresh installs *and* on every existing database.
2. When the flag is **OFF**, the 08:00 cron sends nothing: `performAutoEmailPass` returns immediately
   with `{ blocked: true, sentCount: 0, skippedCount: 0, failedCount: 0, results: [] }`. No template
   is rendered, no SMTP connection is opened, no `email_log` row is written.
3. When the flag is **OFF**, an enabled `auto` template whose send date has come surfaces in the
   pending « à valider » list (dashboard widget + Emails page) exactly like a `manual` one: same
   preview, same one-click send, same acknowledge/mark-sent actions. Nothing is lost, nothing is sent.
4. When the flag is **OFF**, a confirmed online payment does **not** send the « Confirmation de
   réservation » email. The pair *(confirmation template, reservation)* is added to
   `email_manual_queue` instead, so it appears in the same « à valider » list. Everything else the
   payment effect does — devis → reservation conversion, marking the échéance paid, the operator
   notification, the overlap-conflict check — is unchanged.
5. Emails that are **not** guest mail are out of this flag's reach and keep their current behaviour:
   - operator notifications (`utils/notificationService`) — already governed by
     `notificationsEnabled` in the same Réglages page;
   - account emails (`controllers/usersController`): invitation, password reset, email verification.
     Gating those would break « mot de passe oublié ».
6. Emails sent by an **explicit operator action** are never blocked, flag or no flag: the « Envoyer »
   button on the pending list / reservation (`emailsController.send`), the acompte/solde payment
   requests (`paymentRequestService.sendPaymentRequest`, host-triggered), the cancellation notice
   (`reservationCancellationController`), and the SMTP test email (`settingsController`).
7. When the flag is **ON**, behaviour is byte-for-byte what it is today: the 08:00 cron sends `auto`
   templates, the payment confirmation leaves on payment, and `auto` templates stay out of the
   pending list (no double proposal).
8. The Emails page states the situation instead of lying about it: while the flag is OFF, a warning
   banner explains that automatic sending is disabled, and every enabled template in « Automatique »
   mode carries a warning chip. The mode itself stays selectable — turning the flag back on must not
   require re-editing templates.
9. A blocked pass does **not** consume the day's cron slot. The 08:00 pass runs once per local day;
   if it was blocked, the guard is released so that authorising automatic sending later the same day
   lets the next tick run the real pass — rather than waiting for tomorrow, by which point today's
   due templates no longer match their send date.
10. A blocked email produces **no** `email_log` row. `email_log` is the record of send *attempts*;
   nothing was attempted. The queue is the record of what is waiting.

**Edge cases:**
- Flag OFF, payment confirms, client has no email on file → the pair is queued anyway; the row shows
  an empty address and the send dialog lets the operator type one (existing behaviour, rule 9 of
  `specs/email-automation.md`).
- Same payment polled twice (webhook + cron) → `email_manual_queue.add` is `INSERT OR IGNORE` on the
  `(templateId, reservationId)` primary key: one row, no duplicate proposal.
- Confirmation template disabled or missing → nothing is queued (mirrors the current `no-template`
  early return of `sendReservationTemplateEmail`).
- Flag turned ON later → the cron resumes; pairs already queued stay in the queue until sent or
  acknowledged. No double send: `reservation_confirmation` is in `EVENT_TRIGGERED_STABLE_KEYS`, so
  the cron never picks it up, and the date-driven candidates are deduped against `email_log`.
- A pair the operator queued by hand (`email_manual_queue`) is shown whatever the template's send
  mode — that is the existing « deliberate resend » path, and this flag does not change it.
- Flag OFF and an `auto` template uses the `validUntil` anchor → it appears in the pending list. The
  cron never handled that anchor anyway (`skipped-unsupported-anchor`), so this is a strict gain.
- Flag OFF, SMTP not configured → nothing changes: the pass returns before touching SMTP.

---

## 4. Architecture

> **Fat backend, thin frontend.** The decision « may this email leave? » is a single server-side
> predicate (`utils/autoSendPolicy`). The client only renders the flag's consequences: a switch, a
> banner, a chip. The `autoSendBlocked` badge shipped to the Emails page is computed on the server,
> not recombined in React from two payloads.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `emails.js` | — | (none — controller wiring already passes `settingsModel`) |
| `controllers/` | `settingsController.js` | T | New `emails` group (`autoSendEnabled` → `emailAutoSendEnabled`); adds the column to `BOOLEAN_INT_COLUMNS` |
| `controllers/` | `emailsController.js` | T | `pending()` passes `includeAutoTemplates: !autoSendAllowed()` to the model and returns `autoSendEnabled` in the payload |
| `controllers/` | `emailTemplatesController.js` | T | `list()` decorates each row with `autoSendBlocked` (enabled + `sendMode = 'auto'` + flag OFF) |
| `models/` | `settingsModel.js` | T | New non-secret column + default `0` + `emailAutoSendEnabled()` accessor + `autoSendEnabled` in the `emails` group of `read()` |
| `models/` | `emailLogModel.js` | T | `listPending({ includeAutoTemplates })` — the four UNION branches switch `t.sendMode = 'manual'` to `t.sendMode IN ('manual', 'auto')` |
| `middleware/` | — | — | (none) |
| `utils/` | `autoSendPolicy.js` | C | Single source of truth: `autoSendAllowed(settingsModel)`. Pure, injectable, unit-tested |
| `utils/` | `settingsResponse.js` | T | New `emails: { autoSendEnabled }` block in the settings payload |
| `utils/` | `emailAutoSendRunner.js` | T | Guard at the top of `performAutoEmailPass` → `{ blocked: true, … }` when the flag is OFF |
| `utils/` | `reservationEmailSender.js` | T | New `buildGatedConfirmationSender` — sends or queues depending on the flag. Lives here, next to `buildConfirmationSender`, because this module injects every dependency and is therefore unit-testable |
| `utils/` | `paymentEffectDeps.js` | T | Wires the real models into the gated sender (no logic of its own) |
| `scheduledTasks.js` | `scheduledTasks.js` | T | Logs the blocked pass in one line, and releases the once-per-day guard so a mid-day authorisation takes effect (rule 9) |
| `database.js` | `database.js` | T | Idempotent `tryAddAppSettingsCol('emailAutoSendEnabled', … NOT NULL DEFAULT 0)` |

**Notes:**
- `autoSendPolicy` is deliberately one small module rather than an inline `settings.emailAutoSendEnabled`
  check at three call sites: the rule « what counts as an automatic send » must have exactly one home.
- No new dependency.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `SettingsPage.jsx` | T | New `emails` group in the draft/dirty/save plumbing; renders the new section |
| `pages/` | `EmailTemplatesPage.jsx` | T | Warning banner while automatic sending is off; warning chip on each `autoSendBlocked` row; helper text on the mode selector |
| `components/` | `SettingsEmailAutomationSection.jsx` | C | « Envoi automatique des emails » card: master switch + explanation of what OFF means |
| `hooks/` | — | — | (none) |
| `services/` | — | — | (none) |
| `utils/` | — | — | (none) |
| `constants/` | — | — | (none) |
| `styles/` | — | — | (none) |
| `api.js` | — | — | (none — existing `/settings` and `/email-templates` calls) |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `ResponsiveTable`, `FormDialog`, `EmailPendingList`, MUI `Card`/`Switch`/`Alert`/`Chip` | All pre-existing. |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | `SettingsEmailAutomationSection` | Follows the established one-card-per-settings-group pattern (`SettingsNotificationsSection`, `SettingsReservationLockSection`, `SettingsVatSection`…). Generifying « a settings card with a switch » across those seven near-identical sections is a worthwhile sweep, but it belongs to the design-system spec, not here. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/settings` | — | `{ …, emails: { autoSendEnabled: boolean } }` | New group; auth required |
| PUT | `/api/settings` | `{ emails: { autoSendEnabled: boolean } }` | Updated settings | Partial-group semantics, like every other group |
| GET | `/api/emails/pending` | — | `[{ … }]` (unchanged array) | Now includes due `auto` templates while the flag is OFF. The array shape is deliberately kept: the dashboard widget and `EmailPendingList` consume it directly, and no client needs the flag here — the templates list already carries `autoSendBlocked` |
| GET | `/api/email-templates` | — | `[{ …, autoSendBlocked: boolean }]` | Server-computed badge |

Auth: all three sit behind the existing session middleware. No new error shape.

---

## 5. Data model

One new column on `app_settings`:

```sql
ALTER TABLE app_settings ADD COLUMN emailAutoSendEnabled INTEGER NOT NULL DEFAULT 0;
```

Added through the existing idempotent `tryAddAppSettingsCol` helper in `server/src/database.js`.

- **Default for existing rows:** `0` (OFF). Deliberate: the safe default is « ask me », and the
  operator has asked for exactly that. This *is* a behaviour change on upgrade — templates currently
  in « Automatique » stop sending on their own and start appearing in the validation queue.
- **Backfill:** none.
- **Data impact:** no existing record is modified, no email history is touched. Nothing can be lost —
  the worst case is an email waiting in the queue instead of having left.
- **CHANGELOG:** ships a `Migration` note stating the new column, the OFF default and its consequence.

## 6. UI / UX

### Réglages — new card « Envoi automatique des emails »

Placed directly after « Notifications de réservation », so the two email switches read as a pair
(one for *my* mail, one for *guest* mail).

```
┌──────────────────────────────────────────────────────────────┐
│ Envoi automatique des emails                                 │
│ Par défaut, GuestFlow ne fait que PROPOSER les emails :       │
│ ils attendent votre validation dans « Emails à envoyer ».    │
│                                                              │
│ [ ○——] Autoriser GuestFlow à envoyer les emails sans          │
│        validation                                            │
│                                                              │
│ ⚠ Activé, les modèles en mode « Automatique » partent seuls  │
│   à 08:00, et la confirmation de réservation part dès qu'un  │
│   paiement en ligne est confirmé.                            │
└──────────────────────────────────────────────────────────────┘
```

The warning line renders only when the switch is ON — off, the card is calm and states the default.

### Page Emails — banner + chip

While the flag is OFF **and** at least one enabled template is in « Automatique » mode, a
`<Alert severity="warning">` sits under the `PageActionBar`:

> **L'envoi automatique est désactivé.** Les modèles en mode « Automatique » ne partent pas seuls :
> ils vous sont proposés dans « Emails à envoyer ». *[Modifier ce réglage]*

The link navigates to `/settings`. The « Mode » chip is **repainted rather than doubled**: an
affected row shows « Auto désactivé » (`warning`) instead of « Auto » (`success`) — one chip that
tells the truth beats two that disagree. One `sendModeChip(row)` helper renders it for both the
desktop table and the mobile card, so the two cannot drift. The mode selector in the edit dialog adds
« L'envoi automatique est désactivé dans les Réglages — cet email sera proposé, pas envoyé. »

The « Emails à envoyer » caption also changes while the flag is OFF, since « Modèles en mode manuel »
would then be false: it says the automatic ones are being proposed there too.

### Pending list

No visual change. An `auto` template proposed because the flag is OFF is indistinguishable from a
`manual` one — that is the point: one list, one habit, one click.

### Responsive behaviour

- **`xs` (≤600px):** the settings card keeps the shared `p: { xs: 2, sm: 3 }` rhythm; the switch label
  wraps onto two lines under the control (MUI `FormControlLabel` default) and stays a ≥44×44px target.
  The Emails-page banner is full-width with its action link stacked below the text.
- **`md` (~900px):** banner text and link sit on one line.
- **`lg` (≥1200px):** unchanged from `md`.
- No horizontal scroll is introduced at any breakpoint.

### Sticky action bar

Both pages already render `PageActionBar` (Réglages: title + Save/Cancel; Emails: title + « Nouveau
modèle » + « Historique »). No change to either bar.

## 7. Test plan

### Server unit tests (35 added, suite at 3471)

- [x] `tests/auto-send-policy.unit.test.js` (C) — accessor ON/OFF, raw-column fallback, missing
      column, a settings model that throws: everything short of an explicit yes reads as no.
- [x] `tests/email-auto-send-runner.unit.test.js` (T) — flag OFF → `{ blocked: true }`, zero sends,
      zero `email_log` rows, SMTP transport never even built; same fixture sends once allowed; a
      settings model that never heard of the switch sends nothing.
- [x] `tests/email-log-model.unit.test.js` (T) — `includeAutoTemplates` surfaces due `auto`
      templates across all four anchors (`start`, `validUntil`, `depositDueDate`, `balanceDueDate`),
      keeps the sent/acknowledged dedup, and never resurrects a disabled template.
- [x] `tests/confirmation-email-gate.unit.test.js` (C) — payment confirmation: sent when authorised;
      queued and never sent when not; queued once when the webhook and the poll race; not queued at
      all when the template is missing or disabled; a queue failure never breaks the payment flow.
- [x] `tests/emails-controller.unit.test.js` (T) — `pending()` merges the auto candidates only while
      the flag is OFF; `send()` still ships an `auto` template on the operator's click.
- [x] `tests/email-templates-controller.unit.test.js` (T) — `autoSendBlocked` is true only for
      enabled + `auto` + flag OFF, and a missing settings model reads as blocked.
- [x] `tests/settings-email-auto-send.unit.test.js` (C) — default OFF on a fresh DB *and* on one that
      predates the column; upsert round-trip; other settings untouched.
- [x] `tests/settings-controller-email-auto-send.unit.test.js` (C) — the `emails` group coerces to
      0/1 at the HTTP boundary; partial saves never rewrite the column.
- [x] `tests/payment-dunning-emails.unit.test.js` (T) — its fake settings now authorise the cron
      explicitly, since that suite describes what the pass does once allowed.

### Client tests (16 added, suite at 1082)

- [x] `components/__tests__/SettingsEmailAutomationSection.test.jsx` (C) — default OFF, the
      consequences warning appears only when ON, toggling both ways, disabled while saving.
- [x] `pages/__tests__/SettingsPage.emailAutomation.test.jsx` (C) — hydration from the server, a
      payload without the `emails` group falling back to OFF, and a save that sends **only**
      `{ emails: { autoSendEnabled } }`.
- [x] `pages/__tests__/EmailTemplatesPage.test.jsx` (T) — « Auto désactivé » replaces « Auto », the
      banner appears only when a template is actually blocked, its button navigates to `/settings`,
      the queue caption explains itself, and the edit dialog carries the helper text.

### E2E

- [x] `npm run test:e2e` — 65 passed, 1 skipped (no change needed; the suite covers the settings
      round-trip generally).

### Manual UI verification (2026-08-20, dev server + Playwright-driven browser)

- [x] Réglages: the switch is OFF on load; the consequences warning appears only when it is ON.
- [x] Emails page with a template flipped to « Automatique »: warning banner, « Auto désactivé »
      chip, self-explaining queue caption, helper text in the edit dialog.
- [x] The queue actually changes hands — for a date-driven pair: manual/OFF → proposed;
      auto/OFF → still proposed; auto/ON → gone (the cron owns it); back to OFF → proposed again.
- [x] The **real** 08:00 pass against the **real** dev database (with a spy transport, so nothing
      could leave): `{ blocked: true }`, zero send attempts, `email_log` untouched.
- [x] Mobile (390 px): no horizontal scroll on either page; the card and banner stack cleanly.
- [ ] **Not verified end to end:** the confirmation email on a genuinely confirmed Qonto payment —
      that path needs a real payment. It is covered by `confirmation-email-gate.unit.test.js`.

## 8. Out of scope

- Gating operator notifications or account emails (rule 5) — they have their own switch, or must
  never be gated at all.
- A per-template override of the global flag. One switch, one rule.
- Removing the « Automatique » mode or the 08:00 cron entirely.
- Logging blocked emails as a new `email_log` status — the queue is the record (rule 9).
- Push notifications, which are not email and are governed by their own per-user preferences.

## 9. Open questions

- Q: Should the confirmation-on-payment email be exempt, since the guest has just paid and expects a
  receipt?
  - A (2026-08-20): **No.** It is blocked like any other guest email and lands in the validation
    queue. The operator explicitly chose « tous les mails clients ».
- Q: What happens to an email the automation wanted to send?
  - A (2026-08-20): It goes to the « à valider » queue — one click to send, nothing lost.
- Q: Keep the « Automatique (envoi à 08:00) » mode in the templates UI?
  - A (2026-08-20): Yes, kept and selectable, but flagged with a visible warning while the global
    flag is OFF.
