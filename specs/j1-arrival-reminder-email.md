# J-1 arrival-reminder email

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/j1-arrival-reminder-email` _(user-managed)_ |
| **Created** | 2026-06-12 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

GuestFlow already ships a J-7 arrival-reminder email (`arrival_reminder_7d`, spec
`email-automation.md` + `j7-email-baby-beds.md`). The email engine supports `{{tokens}}` and
single-level `{{#if flag}}…{{else}}…{{/if}}` conditionals, rendered server-side by
`utils/emailTemplateRenderer.js` against the context produced by `utils/emailContextBuilder.js`.

The operator wants a **second, last-minute reminder sent the day before arrival (J-1)**. Beyond the
stay recap, it must surface three actionable, warm reminders that the J-7 template does not cover:

- bring a **caution cheque** when the security deposit has not been collected;
- bring **their own bed linen** when the bed-linen option was not booked;
- the **end-of-stay cleaning is at their charge** when the cleaning ("Ménage") option was not booked.

It must also list the booked **resources** (e.g. *Bain nordique*, *Lit bébé*) alongside the options —
today the email context only loads `reservation_options`, never `reservation_resources`.

Three gaps in the current engine block this:

| Need | Current state |
|---|---|
| List booked **resources** | ❌ resources are not loaded into the email context |
| **Caution not collected** flag | ⚠️ only `cautionNotBanked` exists, keyed on `depositPaid` (acompte), not on `cautionReceived` — wrong signal for "the caution cheque is still owed" |
| **Cleaning not booked** flag | ❌ the "Ménage" option carries no `autoOptionType`, so it cannot be detected |
| **Bed linen not booked** | ⚠️ `hasBedLinenOption` exists; the "not booked" case is its `{{else}}` branch (no new flag needed) |

## 2. Goal

The operator can send a warm, personalised **J-1 reminder** that recaps the stay (dates, hours, booked
options **and** resources) and, only when relevant, reminds the guest to bring a caution cheque, bring
their own bed linen, and/or that the end-of-stay cleaning is at their charge.

## 3. Functional rules

1. A new **default template** `arrival_reminder_1d` ("Rappel arrivée — J-1") is seeded: `dayOffset = -1`,
   `sendMode = 'manual'`, `enabled = true`. Manual → it surfaces in the **"Emails à envoyer"** queue the
   day before arrival; the operator reviews and clicks **Envoyer** (no auto-send).
2. The body recaps: logement (`{{propertyName}}`), arrivée (`{{startDate}}` à partir de
   `{{checkInTime}}`), départ (`{{endDate}}` avant `{{checkOutTime}}`).
3. **Options** booked are listed when present, via the existing `{{#if hasOptions}}{{optionsList}}{{/if}}`.
4. **Resources** booked are listed when present, via a new `{{#if hasResources}}{{resourcesList}}{{/if}}`.
   `{{resourcesList}}` = the booked resources' names, comma-separated, sorted (fr locale).
5. **Caution reminder** appears only when the caution is required but not yet collected:
   `cautionNotReceived = cautionAmount > 0 AND cautionReceived != 1`. Copy invites the guest to bring a
   cheque of `{{cautionAmount}}` on arrival.
6. **Bed-linen reminder** appears only when the bed-linen option was **not** booked — the `{{else}}`
   branch of `{{#if hasBedLinenOption}}`. Copy invites the guest to bring their own linen.
7. **Cleaning reminder** appears only when the cleaning option was **not** booked — the `{{else}}`
   branch of a new `{{#if hasCleaningOption}}` flag. Copy reminds that end-of-stay cleaning is at their
   charge.
8. To make rule 7 possible, the existing **"Ménage" option is tagged `autoOptionType = 'cleaning'`** at
   boot (idempotent promotion, by exact title match, only when currently untyped). `hasCleaningOption` =
   at least one booked option whose linked option has `autoOptionType = 'cleaning'`.
9. Tone is warm and welcoming throughout (vacation context). All copy is French.
10. All computation is server-side (fat backend). The template body stays declarative — only tokens and
    flags, no logic. Missing tokens render as empty string (never leak `{{…}}`).

**Edge cases:**
- No options and no resources → neither list line renders (no blank "Options :" artefact).
- Caution already received (`cautionReceived = 1`) or `cautionAmount = 0` → no caution reminder.
- Bed-linen option booked → no "bring your own linen" line (the `{{#if}}` branch renders instead, mirroring J-7).
- Cleaning option booked → no "cleaning at your charge" line.
- A booked resource that is *offered* (free) is still listed (the guest reserved it).
- Operator's pre-existing J-1 template (if they hand-created one) is **not** overwritten by the seed
  (insert-iff-`stableKey`-missing contract, see §5).

---

## 4. Architecture

> **Fat backend, thin frontend.** All detection (caution owed, linen/cleaning not booked), data shaping
> (resources list), and rendering happen server-side. The client only gains a few picker chips in the
> email-template editor so the operator can insert the new tokens/flags.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `controllers/` | `controllers/emailsController.js` | T | `loadReservationGraph` also loads `reservation_resources` joined with `resources.name`; passes `resources` into `buildContext`. Shared by preview + send + cron, so all stay in sync. |
| `utils/` | `utils/emailContextBuilder.js` | T | New `vars.resourcesList`; new flags `hasResources`, `cautionNotReceived` (`cautionAmount>0 && cautionReceived!=1`), `hasCleaningOption` (any booked option `autoOptionType==='cleaning'`). Accepts a new `resources` input array. |
| `utils/` | `utils/defaultEmailTemplatesRegistry.js` | T | Append the `arrival_reminder_1d` default template (subject + body using the tokens/flags above). |
| `utils/` | `utils/cleaningOptionSeed.js` | C | Idempotent boot promotion: `UPDATE options SET autoOptionType='cleaning' WHERE LOWER(TRIM(title)) IN ('ménage','menage') AND (autoOptionType IS NULL OR autoOptionType='')`. Mirrors `bathroomLinenSeed.js`'s promotion path (no row creation — the operator already has the option). |
| `database.js` | `database.js` | T | Invoke `ensureDefaultCleaningOption(db)` at boot, next to the other option seeds (~L1788-1800). |
| `utils/` | `utils/emailTemplateRenderer.js` | REUSE | Generic; resolves any vars/flags. No change. |
| `models/` | `models/emailTemplatesModel.js`, `emailLogModel.js` | REUSE | The new template is just another row; pending-queue + send + log paths are type-agnostic. No change. |
| `scheduledTasks.js` | — | REUSE | The J-1 row participates in the existing manual-pending pipeline (`dayOffset` drives the send date). No change. |

**Notes:**
- New utils are pure / idempotent and unit-testable.
- No new dependency.
- `loadReservationGraph` is the single loader for preview, send, acknowledge, and cron — editing it once
  keeps every send path consistent.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `pages/EmailTemplatesPage.js` | T | Add picker chips: variable **"Liste ressources"** → `{{resourcesList}}`; conditions **"Si ressources"** → `{{#if hasResources}}`, **"Si caution non reçue"** → `{{#if cautionNotReceived}}`, **"Si ménage"** → `{{#if hasCleaningOption}}`. Pure UI sugar (insert text at cursor). |
| `pages/` | `pages/OptionsPage.js` | — | No change. The "Ménage" option becomes non-deletable once typed (existing rule `isDeleteDisabled={(item)=>Boolean(item.autoOptionType)}`) — accepted side effect (it now drives email logic). |
| `api.js` | `api.js` | — | No change (existing preview/send/templates endpoints unchanged). |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `FormDialog`, `PageActionBar`, the existing template-editor dialog | Pre-existing; reused as-is. |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | — | None; this rides entirely on the existing email-template UI. |

### 4.3 API contract

No new endpoints, no changed signatures. The new template flows through the existing contract:

| Method | Endpoint | Notes |
|---|---|---|
| GET | `/api/emails/preview?reservationId&templateId` | Now returns a body that may include the resources line + the 3 conditional reminders. |
| POST | `/api/emails/send` | Unchanged. |
| GET | `/api/emails/pending` | The J-1 row appears on its send date like any manual template. |
| GET/POST/PUT/DELETE | `/api/email-templates*` | Unchanged. |

---

## 5. Data model

- **`reservations`** — no change. Uses existing `cautionAmount`, `cautionReceived`.
- **`reservation_resources` / `resources`** — no change. Now read by the email loader (join on `name`).
- **`options.autoOptionType`** — no schema change (column exists). One **idempotent data promotion**:
  tag the "Ménage" option with `autoOptionType = 'cleaning'` (boot seed, untyped rows only).
- **`email_templates`** — no schema change. One new **seeded row** (`stableKey='arrival_reminder_1d'`),
  inserted only if absent.

**Data impact:**
- The cleaning-tag promotion only writes `autoOptionType` on rows where it is currently NULL/empty and the
  title matches "Ménage"/"Menage" — no existing data lost, fully idempotent across boots.
- Seed never overwrites an operator-edited template row.

> **Existing templates are NOT auto-updated** (insert-iff-`stableKey`-missing, per `email-automation.md`
> §5). Fresh installs (or a deleted → re-seeded J-1) get the new default automatically. An operator who
> already created a J-1 row keeps it; to adopt the default they delete their row (re-seeds next boot) or
> paste the body via Paramètres → Emails.

## 6. UI / UX

**Where:** Paramètres → Emails (`/emails`). No new screen.

- **Template list:** a new row "Rappel arrivée — J-1" (chip `J-1`), sortable/queued like J-7.
- **Pending queue ("Emails à envoyer"):** the J-1 reminder surfaces the day before each arrival; operator
  previews → Envoyer.
- **Editor dialog:** 1 new variable chip + 3 new condition chips (see §4.2). Inserted at cursor, same as
  existing chips.

**Default J-1 body (French, warm):**

```
Bonjour {{clientFirstName}},

C'est avec grand plaisir que nous vous accueillons dès demain {{propertyWithArticle}} !
Voici un dernier rappel avant votre arrivée.

Votre séjour :
- Logement : {{propertyName}}
- Arrivée  : le {{startDate}} à partir de {{checkInTime}}
- Départ   : le {{endDate}} avant {{checkOutTime}}
{{#if hasOptions}}- Options réservées : {{optionsList}}
{{/if}}{{#if hasResources}}- Équipements réservés : {{resourcesList}}
{{/if}}
{{#if cautionNotReceived}}Pour finaliser votre arrivée, pensez à prévoir un chèque de caution de {{cautionAmount}} à nous remettre sur place.

{{/if}}{{#if hasBedLinenOption}}{{else}}Le linge de lit n'est pas inclus dans votre réservation : pensez à apporter le vôtre (draps, taies d'oreiller). Vous pouvez aussi nous demander de l'ajouter, avec plaisir.

{{/if}}{{#if hasCleaningOption}}{{else}}Le ménage de fin de séjour n'a pas été réservé : il reste à votre charge avant le départ. N'hésitez pas si vous souhaitez l'ajouter, nous nous en occupons volontiers.

{{/if}}Nous restons à votre entière disposition d'ici là — répondez simplement à cet email ou appelez-nous au {{companyPhone}}.

Très belles vacances, et à demain !
{{senderName}}
```

**Subject:** `Demain, votre arrivée {{propertyWithArticle}}`

- **Copy / states:** missing tokens → empty; an unconfigured SMTP surfaces the existing
  `EMAIL_NOT_CONFIGURED` flow (unchanged).
- **Responsive:** no layout change; the email editor dialog already goes `fullScreen` on `xs`. The 4 new
  chips wrap in the existing flex chip rows on mobile (no new breakpoints). No table changes.
- **Sticky action bar:** `EmailTemplatesPage` keeps its existing `PageActionBar`; no new page-level action.

## 7. Test plan

### Server unit tests
- [x] `tests/email-context-builder.unit.test.js` (+5): `resourcesList` joins + sorts names; empty when no
  resources; `hasResources` true/false; `cautionNotReceived` true only when `cautionAmount>0 &&
  cautionReceived!=1` (independent from `depositPaid`); `hasCleaningOption` true only when a booked option
  is `autoOptionType==='cleaning'`.
- [x] `tests/email-template-renderer.unit.test.js` (+3, end-to-end on the shipped J-1 body): renders the
  resources line, the caution reminder, the "bring your own linen" else-branch, the "cleaning at your
  charge" else-branch — and renders none of them in the all-booked / caution-received case.
- [x] `tests/default-email-templates-seed.unit.test.js` / `default-email-templates-registry.unit.test.js`:
  the `arrival_reminder_1d` entry is covered by the generic per-registry-entry seed/insert-iff-absent loop.
- [x] `tests/cleaning-option-seed.unit.test.js` (C, +5): promotes an untyped "Ménage"/"Menage" row to
  `autoOptionType='cleaning'`; idempotent; leaves an already-typed row and non-matching titles untouched.
- [x] Migration + seed verified on a copy of the production DB (Ménage tagged, J-1 seeded, no error).

### Manual UI verification
- [ ] Preview J-1 for a reservation with options + resources, caution not received, no linen, no cleaning
  → all four lines present, warm copy correct.
- [ ] Preview J-1 for a reservation with caution received + linen + cleaning booked → none of the three
  reminders, just the recap.
- [ ] The J-1 reminder appears in "Emails à envoyer" the day before arrival; Envoyer logs it in history.
- [ ] Regression: J-7 email still renders identically (its `cautionNotBanked` block unchanged).
- [ ] Mobile (`xs`): editor dialog full-screen, the new chips reachable.

## 8. Out of scope

- **Auto-send** of the J-1 reminder (kept manual, per decision).
- **Realigning J-7's `cautionNotBanked`** flag onto `cautionReceived`. The J-1 template uses the new,
  precise `cautionNotReceived`; J-7 keeps its existing proxy to avoid changing its current behavior. A
  later cleanup could converge them.
- A generic `autoOptionType` selector in the OptionsPage editor (cleaning is tagged by boot seed, like
  bed-linen/breakfast/bathroom).
- Surfacing these reminders in any email other than J-1.
- A "reset template to default / sync default body" action.

## 9. Open questions

Resolved during scoping (2026-06-12):
- **Send mode?** → Manual (queue), consistent with J-7.
- **List resources too?** → Yes, options + resources.
- **How to detect cleaning?** → Tag the existing "Ménage" option `autoOptionType='cleaning'`; presence on
  the reservation = cleaning booked.
