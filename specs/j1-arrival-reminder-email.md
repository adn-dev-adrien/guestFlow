# J-2 arrival-reminder email

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/arrival-reminder-j2` _(user-managed)_ |
| **Created** | 2026-06-12 |
| **Updated** | 2026-06-18 — moved J-1 → J-2; stay date instead of « demain »; GPS line; conditional nordic-bath reminder (gear + scheduled slot); cleaning matched by option NAME (bug fix); force-overwrite migration. Recap now recalls the **reservation number** (`{{#if hasReservationNumber}}{{reservationNumber}}`) — see `specs/reservation-number-and-search.md`. |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

GuestFlow already ships a J-7 arrival-reminder email (`arrival_reminder_7d`, spec
`email-automation.md` + `j7-email-baby-beds.md`). The email engine supports `{{tokens}}` and
single-level `{{#if flag}}…{{else}}…{{/if}}` conditionals, rendered server-side by
`utils/emailTemplateRenderer.js` against the context produced by `utils/emailContextBuilder.js`.

The operator wants a **second, last-minute reminder sent two days before arrival (J-2)**. Beyond the
stay recap, it must surface actionable, warm reminders that the J-7 template does not cover:

- bring a **caution cheque** when the security deposit has not been collected;
- bring **their own bed linen** when the bed-linen option was not booked;
- the **end-of-stay cleaning is at their charge** when the cleaning ("Ménage") option was not booked;
- bring their **own towel / bathrobe / flip-flops for the nordic bath** when the *Bain nordique* resource
  was booked (nothing is provided on site) — and recall the **scheduled slot(s)** when hourly sessions are
  set on the reservation.

It must also list the booked **resources** (e.g. *Bain nordique*, *Lit bébé*) alongside the options —
today the email context only loads `reservation_options`, never `reservation_resources` — and tell the
guest how to reach the property (**search « Domaine Solio » on their GPS**).

Because it is sent J-2, the copy must **never say « demain »**: it opens with the actual **stay start
date** (`{{startDate}}`).

Gaps in the current engine this addresses:

| Need | Current state |
|---|---|
| List booked **resources** | ❌ resources are not loaded into the email context |
| **Caution not collected** flag | ⚠️ only `cautionNotBanked` exists, keyed on `depositPaid` (acompte), not on `cautionReceived` — wrong signal for "the caution cheque is still owed" |
| **Cleaning not booked** flag | ❌ matching on `autoOptionType` missed operator-created "Ménage" options (they carry no tag) → the "at your charge" notice wrongly showed even when cleaning WAS booked. Now matched by option **NAME**. |
| **Nordic-bath reminder** | ❌ no flag; the *Bain nordique* resource carries no tag. Matched by resource **NAME**; the scheduled slot is read from `reservation_resources.sessions`. |
| **Bed linen not booked** | ⚠️ `hasBedLinenOption` exists; the "not booked" case is its `{{else}}` branch (no new flag needed) |

## 2. Goal

The operator can send a warm, personalised **J-2 reminder** that recaps the stay (dates, hours, booked
options **and** resources), tells the guest how to reach the property, and, only when relevant, reminds
them to bring a caution cheque, bring their own bed linen, that the end-of-stay cleaning is at their
charge, and/or to bring their nordic-bath gear (with the scheduled slot when set).

## 3. Functional rules

1. The **default template** `arrival_reminder_1d` (operator-facing name "Rappel arrivée — J-2") is seeded
   with `dayOffset = -2`, `sendMode = 'manual'`, `enabled = true`. Manual → it surfaces in the
   **"Emails à envoyer"** queue two days before arrival; the operator reviews and clicks **Envoyer** (no
   auto-send). The `stableKey` stays `arrival_reminder_1d` (legacy) — renaming it would re-seed a duplicate.
2. The body recaps: logement (`{{propertyName}}`), arrivée (`{{startDate}}` à partir de
   `{{checkInTime}}`), départ (`{{endDate}}` avant `{{checkOutTime}}`). It opens with the **stay start
   date** (`{{startDate}}`), never « demain » (sent J-2).
3. **Options** booked are listed when present, via the existing `{{#if hasReservedOptions}}{{reservedOptionsList}}{{/if}}`.
4. **Resources** booked are listed when present, via `{{#if hasResources}}{{resourcesList}}{{/if}}`.
   `{{resourcesList}}` = the booked resources' names, comma-separated, sorted (fr locale).
5. A fixed **GPS line** tells the guest to search « Domaine Solio » on their GPS.
6. **Caution reminder** appears only when the caution is required but not yet collected:
   `cautionNotReceived = cautionAmount > 0 AND cautionReceived != 1`. Copy invites the guest to bring a
   cheque of `{{cautionAmount}}` on arrival.
7. **Bed-linen reminder** appears only when the bed-linen option was **not** booked — the `{{else}}`
   branch of `{{#if bedLinenBringYourOwn}}` (linen-by-default logic, spec `j1-linen-default-message.md`).
8. **Cleaning reminder** appears only when the cleaning option was **not** booked — the `{{else}}`
   branch of `{{#if hasCleaningOption}}`. Copy reminds that end-of-stay cleaning is at their charge.
9. `hasCleaningOption` is matched by **option NAME**: at least one booked option whose name contains
   « ménage » (accent- and case-insensitive), OR whose linked option carries `autoOptionType = 'cleaning'`
   (fallback). This is the bug fix — operator-created "Ménage" options carry no `autoOptionType`, so the
   name match is what makes the detection reliable.
10. **Nordic-bath reminder** appears only when the *Bain nordique* resource was booked —
    `{{#if hasNordicBath}}{{nordicBathReminder}}{{/if}}`. `hasNordicBath` is matched by **resource NAME**
    (name contains « nordique », accent/case-insensitive). `{{nordicBathReminder}}` is composed
    server-side into a single sentence (the renderer has no nested conditionals): a warm intro, an
    optional **scheduled-slot recall** when hourly sessions are set (`Votre créneau est réservé le … de … à …`,
    joined by « et » for several), and the **gear sentence** (maillot de bain, peignoir ou serviette,
    tongs — non fournis).
11. Tone is warm and welcoming throughout (vacation context). All copy is French.
12. All computation is server-side (fat backend). The template body stays declarative — only tokens and
    flags, no logic. Missing tokens render as empty string (never leak `{{…}}`).

**Edge cases:**
- No options and no resources → neither list line renders (no blank "Options :" artefact).
- Caution already received (`cautionReceived = 1`) or `cautionAmount = 0` → no caution reminder.
- Bed-linen option booked / provided by default → no "bring your own linen" line (per linen-default logic).
- Cleaning option booked (by name or tag) → no "cleaning at your charge" line.
- Nordic bath booked but **no hourly session** scheduled → reminder shows the gear sentence only (no slot line).
- Nordic bath with several sessions → slots joined by « et ».
- A booked resource that is *offered* (free) is still listed (the guest reserved it).
- The seeded row is **force-overwritten** to this J-2 default on upgrade, even if the operator had
  personalised it (explicit operator decision — see §5). After the one-shot migration, later edits stick.

---

## 4. Architecture

> **Fat backend, thin frontend.** All detection (caution owed, linen/cleaning not booked), data shaping
> (resources list), and rendering happen server-side. The client only gains a few picker chips in the
> email-template editor so the operator can insert the new tokens/flags.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `controllers/` | `controllers/emailsController.js` | T | `loadReservationGraph` also loads `reservation_resources` joined with `resources.name`; passes `resources` into `buildContext`. Shared by preview + send + cron, so all stay in sync. |
| `utils/` | `utils/emailContextBuilder.js` | T | New `vars.resourcesList`; flags `hasResources`, `cautionNotReceived` (`cautionAmount>0 && cautionReceived!=1`). `hasCleaningOption` matched by option **NAME** (`normalizeName(title).includes('menage')`) OR `autoOptionType==='cleaning'` fallback. New `hasNordicBath` flag (resource name contains « nordique ») + `vars.nordicBathReminder` (composed gear + optional slot sentence) + `vars.nordicBathSchedule` (from `reservation_resources.sessions`). Accepts a `resources` input array (rows carry `name` + `sessions`). |
| `utils/` | `utils/defaultEmailTemplatesRegistry.js` | T | `arrival_reminder_1d` def reworked: name "Rappel arrivée — J-2", new subject, `dayOffset = -2`, body with the stay date, GPS line, nordic-bath block. |
| `utils/` | `utils/migrateArrivalReminderJ2.js` | C | One-shot **force-sync** of the `arrival_reminder_1d` row to the registry def: overwrites `name`/`subject`/`body`/`dayOffset`, **preserves** `sendMode`/`enabled`. Idempotent, schema-guarded. |
| `database.js` | `database.js` | T | Run `migrateArrivalReminderJ2` once at boot (guarded by the `migrations` table, key `arrival_reminder_j2_overwrite_v1`), AFTER the exact-match J-1 content-migration chain so it has the final say. |
| `utils/` | `utils/emailTemplateRenderer.js` | REUSE | Generic; resolves any vars/flags. No change. |
| `models/` | `models/emailTemplatesModel.js`, `emailLogModel.js` | REUSE | The new template is just another row; pending-queue + send + log paths are type-agnostic. No change. |
| `scheduledTasks.js` | — | REUSE | The J-2 row participates in the existing manual-pending pipeline (`dayOffset` drives the send date). No change. |

**Notes:**
- New utils are pure / idempotent and unit-testable.
- No new dependency.
- `loadReservationGraph` is the single loader for preview, send, acknowledge, and cron — editing it once
  keeps every send path consistent.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `pages/EmailTemplatesPage.js` | — | **No change this iteration.** The existing picker chips (resources, caution, cleaning) remain. The new nordic-bath block ships pre-inserted in the default body via the force-overwrite migration, so the operator never has to insert `{{nordicBathReminder}}` / `{{#if hasNordicBath}}` by hand. (A "Si bain nordique" chip could be added later as sugar.) |
| `pages/` | `pages/OptionsPage.js` | — | No change. Cleaning is now detected by **option NAME**, so the "Ménage" option no longer needs an `autoOptionType` tag and stays freely deletable. |
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
| GET | `/api/emails/pending` | The J-2 row appears on its send date like any manual template. |
| GET/POST/PUT/DELETE | `/api/email-templates*` | Unchanged. |

---

## 5. Data model

- **`reservations`** — no change. Uses existing `cautionAmount`, `cautionReceived`.
- **`reservation_resources` / `resources`** — no change. Read by the email loader (join on `name`, and the
  `sessions` JSON for the nordic-bath slot recall).
- **`options`** — no change. Cleaning is now detected by **name** in the context builder (no data tagging
  required), so an operator-created "Ménage" option is recognised without an `autoOptionType` tag.
- **`email_templates`** — no schema change. Existing `arrival_reminder_1d` row is **force-overwritten** to
  the J-2 default by the one-shot migration; fresh installs get it from the (insert-only) seed.

**Data impact:**
- The J-2 migration overwrites `name`/`subject`/`body`/`dayOffset` of the `arrival_reminder_1d` row and is
  guarded by the `migrations` table → runs exactly once. `sendMode`/`enabled` (the operator's
  auto-vs-manual + on/off choice) are preserved.

> **The seeded row IS overwritten on upgrade — by explicit operator decision.** Unlike the insert-only
> seed contract, Adrien asked to force the J-2 copy onto the existing row even if it had been personalised
> (the old J-1 wording was wrong: « demain », no GPS, no nordic reminder, cleaning false-positive). The
> migration runs once (migrations-table guard), so any edit the operator makes *after* the upgrade sticks.

## 6. UI / UX

**Where:** Paramètres → Emails (`/emails`). No new screen.

- **Template list:** the row "Rappel arrivée — J-2" (chip `J-2`), sortable/queued like J-7.
- **Pending queue ("Emails à envoyer"):** the J-2 reminder surfaces two days before each arrival; operator
  previews → Envoyer.
- **Editor dialog:** the existing variable/condition picker chips. Inserted at cursor.

**Default J-2 body (French, warm):**

```
Bonjour {{clientFirstName}},

C'est avec grand plaisir que nous vous accueillons le {{startDate}} {{propertyWithArticle}} !
Voici les informations utiles avant votre arrivée.

Votre séjour :
{{#if hasReservationNumber}}- N° de réservation : {{reservationNumber}}
{{/if}}- Logement : {{propertyName}}
- Arrivée  : le {{startDate}} à partir de {{checkInTime}}
- Départ   : le {{endDate}} avant {{checkOutTime}}
{{#if hasReservedOptions}}- Option(s) réservée(s) : {{reservedOptionsList}}
{{/if}}{{#if hasResources}}- Équipements réservés : {{resourcesList}}
{{/if}}
Pour vous rendre sur place, recherchez simplement « Domaine Solio » sur votre GPS.

{{#if cautionNotReceived}}Pour finaliser votre arrivée, pensez à prévoir un chèque de caution de {{cautionAmount}} à nous remettre sur place.

{{/if}}{{#if complementToCollect}}{{complementNotice}}

{{/if}}{{#if bedLinenProvidedByDefault}}Pour votre confort, les lits seront faits à votre arrivée.

{{/if}}{{#if bedLinenBringYourOwn}}Le linge de lit n'est pas inclus dans votre réservation : pensez à apporter le vôtre (draps, taies d'oreiller). Vous pouvez aussi nous demander de l'ajouter, avec plaisir.

{{/if}}{{#if hasCleaningOption}}{{else}}Le ménage de fin de séjour n'a pas été réservé : il reste à votre charge avant le départ. N'hésitez pas si vous souhaitez l'ajouter, nous nous en occupons volontiers.

{{/if}}{{#if hasNordicBath}}{{nordicBathReminder}}

{{/if}}Nous restons à votre entière disposition d'ici là — répondez simplement à cet email ou appelez-nous au {{companyPhone}}.

Très belles vacances, et à très bientôt !
{{senderName}}
```

**Subject:** `Votre arrivée approche {{propertyWithArticle}}`

`{{nordicBathReminder}}` renders (server-composed) e.g.:
> Vous avez réservé le bain nordique : un véritable moment de détente vous attend ! Votre créneau est
> réservé le samedi 12 juillet 2026 de 18:00 à 19:30. Pour en profiter pleinement, pensez à emporter votre
> maillot de bain, un peignoir ou une serviette, ainsi qu'une paire de tongs — ces équipements ne sont pas
> fournis sur place.

- **Copy / states:** missing tokens → empty; an unconfigured SMTP surfaces the existing
  `EMAIL_NOT_CONFIGURED` flow (unchanged).
- **Responsive:** no layout change; the email editor dialog already goes `fullScreen` on `xs`. The 4 new
  chips wrap in the existing flex chip rows on mobile (no new breakpoints). No table changes.
- **Sticky action bar:** `EmailTemplatesPage` keeps its existing `PageActionBar`; no new page-level action.

## 7. Test plan

### Server unit tests
- [x] `tests/email-context-builder.unit.test.js`: `resourcesList` joins + sorts names; `hasResources`
  true/false; `cautionNotReceived` precise flag; **`hasCleaningOption` matched by option NAME**
  (tagged, by-name, by-name-no-accent, unrelated); **`hasNordicBath` matched by resource NAME**;
  `nordicBathReminder` gear-only when unscheduled, slot-recall when sessions set; empty when no nordic bath.
- [x] `tests/arrival-reminder-j2-migration.unit.test.js` (new, +6): force-syncs name/subject/body/dayOffset
  even on a personalised row; preserves sendMode/enabled; idempotent; ignores other templates; `not_found`
  when absent (no insert side-effect); `skipped-schema` on a pre-`stableKey` schema.
- [x] `tests/default-email-templates-registry.unit.test.js` (+1): `arrival_reminder_1d` shipped at
  `dayOffset = -2`, name "Rappel arrivée — J-2", new subject, no « demain », GPS line + nordic-bath block.
- [x] Full suite green (`cd server && npm test`) — 1637 tests.

### Manual UI verification
- [ ] Preview J-2 for a reservation with options + resources, caution not received, no linen, no cleaning,
  nordic bath with a scheduled slot → all lines present incl. the slot recall, warm copy correct.
- [ ] Preview J-2 for a reservation with caution received + linen + cleaning booked (operator "Ménage"
  option without a tag) → none of the reminders, no false "cleaning at your charge" line.
- [ ] The J-2 reminder appears in "Emails à envoyer" two days before arrival; Envoyer logs it in history.
- [ ] Regression: J-7 email still renders identically (its `cautionNotBanked` block unchanged).
- [ ] Upgrade check: an install with a personalised old J-1 row gets force-overwritten to J-2 once.

## 8. Out of scope

- **Auto-send** of the J-2 reminder (kept manual, per decision).
- **Realigning J-7's `cautionNotBanked`** flag onto `cautionReceived`. The J-2 template uses the new,
  precise `cautionNotReceived`; J-7 keeps its existing proxy to avoid changing its current behavior. A
  later cleanup could converge them.
- A generic `autoOptionType` selector in the OptionsPage editor (cleaning is tagged by boot seed, like
  bed-linen/breakfast/bathroom).
- Surfacing these reminders in any email other than J-2.
- A "reset template to default / sync default body" action.

## 9. Open questions

Resolved during scoping (2026-06-12):
- **Send mode?** → Manual (queue), consistent with J-7.
- **List resources too?** → Yes, options + resources.
- **How to detect cleaning?** → Tag the existing "Ménage" option `autoOptionType='cleaning'`; presence on
  the reservation = cleaning booked.
