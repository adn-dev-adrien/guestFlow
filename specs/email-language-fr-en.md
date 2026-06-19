# Bilingual emails (French / English) per reservation

| Field | Value |
|---|---|
| **Status** | Approved |
| **Branch** | `feature/email-language-fr-en` _(user-managed)_ |
| **Created** | 2026-06-19 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Every GuestFlow email is rendered **in French**: the template bodies (`email_templates.subject` / `body`)
are French, and `utils/emailContextBuilder.js` composes several **French sentences/labels** server-side —
`nordicBathReminder`, `complementNotice`, `babyBedNotice`, `bedConfig` (« lit double / simple / bébé »),
the long dates (`formatDateLong` → « 10 juillet 2026 »), and `propertyWithArticle` (« au Gite »). The
renderer ([emailTemplateRenderer.js](../server/src/utils/emailTemplateRenderer.js)) is language-agnostic —
it just substitutes tokens/flags.

There is precedent for per-reservation language: devis PDFs already support `fr`/`en` via
`reservations.pdfLanguage` ([database.js:374](../server/src/database.js#L374)).

The operator hosts foreign guests and wants emails sent **in the guest's language**. Translating only the
template bodies is not enough — the **server-composed French strings** would still leak into an English
email. The whole rendering pipeline must become language-aware.

## 2. Goal

Each reservation carries an **email language** (`fr` default, or `en`), editable on the fiche. When an email
is previewed/sent for that reservation, both the **template body** and every **server-composed string**
render in that language. The two shipped default reminders (J-7, J-2) ship with an English translation.

## 3. Functional rules

1. **Per-reservation language.** New column `reservations.emailLanguage` ∈ {`fr`, `en`}, default `fr`,
   editable on the reservation fiche. Independent from `pdfLanguage` (a later cleanup could unify them).
2. **Bilingual templates.** New columns `email_templates.subjectEn` + `bodyEn` (nullable). A template thus
   holds a French subject/body and an optional English subject/body. The editor lets the operator fill both.
3. **Language selection at render.** Preview + send + auto-send resolve the language from the reservation's
   `emailLanguage`. When `en`:
   - use `subjectEn`/`bodyEn` **if non-empty**, else **fall back** to the French `subject`/`body` (an
     operator template without an English version still sends, in French — never blank);
   - build the email context in English (rule 4).
3b. The API accepts an optional `lang` override on preview/send (the authoritative default stays the
    reservation's `emailLanguage`). The **client FR/EN override toggle in the preview dialog is deferred**
    (out of scope for this PR) — the reservation's language drives the preview. The server already honours
    a `lang` query/body param, so the toggle can be added later with no backend change.
4. **Language-aware context.** `buildContext({ …, lang })` returns the same `{vars, flags}` shape, but every
   composed string is emitted in `lang`:
   - dates (`startDate`, `endDate`, `depositDueDate`, `balanceDueDate`) → `formatDateLong(date, lang)`
     (`en` → "10 July 2026" via `Intl` `en-GB`);
   - `bedConfig` → English bed labels ("1 double bed, 2 single beds, 1 baby bed");
   - `propertyWithArticle` → `en` drops the French article (just the property name, or "the &lt;name&gt;");
   - `nordicBathReminder`, `complementNotice`, `babyBedNotice` → English compositions;
   - pure data (names, counts, amounts, option/resource names, `reservationNumber`) is identical in both
     languages. Money keeps the `1 234,56 €` format (the property is in the euro zone).
   - `senderName`, `companyPhone`, etc. unchanged.
5. **Default templates translated.** `arrival_reminder_7d` and `arrival_reminder_1d` ship `subjectEn`/`bodyEn`
   — faithful English translations of the validated French copy (same tokens + `{{#if}}` flags, English
   prose). The English bodies use the exact same token/flag names (the renderer is language-agnostic).
6. **Existing installs backfilled.** An idempotent content migration writes `subjectEn`/`bodyEn` onto the
   two shipped rows **only when they are currently NULL/empty** (operator edits to the English fields are
   preserved; the French side is untouched).
7. **Fat backend.** Language resolution, fallback, and all composition live server-side. The client only
   renders the chosen-language preview it receives and offers the selectors.

**Edge cases:**
- `emailLanguage = 'en'` but the template has no `bodyEn` → French body sent (logged language = the body
  actually used? No — we record the requested language; the body is the FR fallback). Documented; no blank.
- A reservation created before the migration → `emailLanguage` defaults to `fr` (column default).
- Unknown/empty `emailLanguage` value → treated as `fr`.
- `{{nordicBathReminder}}` etc. always match the context language — never a French sentence in an EN email.
- The history (`email_log`) stores the **rendered** subject/body (already language-correct) — no change.

---

## 4. Architecture

> **Fat backend, thin frontend.** The entire bilingual pipeline (language resolve → template side → context
> composition → render) is server-side. The client gains a reservation-fiche selector + two editor fields.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `utils/dateFr.js` | T | `formatDateLong(date, lang='fr')` — `en` formats via `Intl.DateTimeFormat('en-GB', …)` ("10 July 2026"); `fr` unchanged. Same for any long-date helper used by the builder. |
| `utils/` | `utils/emailContextBuilder.js` | T | Accept `lang`. English variants for `formatBedConfig`, `formatPropertyWithArticle`, `nordicBathReminder`, `complementNotice`, `babyBedNotice`, and the date vars. Default `fr` (every existing caller keeps today's output). |
| `utils/` | `utils/defaultEmailTemplatesRegistry.js` | T | Add `subjectEn` + `bodyEn` to both default entries (English translations). |
| `utils/` | `utils/emailTemplateLanguage.js` | C | Pure `pickTemplateSide(template, lang)` → `{ subject, body, usedLang }` (EN if present, else FR fallback) + `normaliseLang(v)`. Unit-testable. |
| `controllers/` | `controllers/emailsController.js` | T | preview/send resolve `lang` from the reservation (`emailLanguage`, optional request override), call `pickTemplateSide` + `buildContext({ …, lang })`. |
| `utils/` | `utils/emailAutoSendRunner.js` | T | Same language resolution for the cron path (reads the reservation's `emailLanguage`). |
| `models/` | `models/emailTemplatesModel.js` | T | Persist/return `subjectEn`/`bodyEn` (insert/update/list/get). |
| `models/` | `models/reservationsModel.js` | T | Persist/return `emailLanguage` (insert/update + reads). |
| `controllers/` | `controllers/reservationsController.js` | T | Accept `emailLanguage` on create/update (validated ∈ {fr,en}). |
| `database.js` | `database.js` | T | Idempotent `ALTER TABLE email_templates ADD COLUMN subjectEn/bodyEn`; `ALTER TABLE reservations ADD COLUMN emailLanguage TEXT NOT NULL DEFAULT 'fr'`; content migration backfilling the two shipped EN bodies (NULL-only). |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `pages/ReservationPage.js` + `components/reservation/StaySection.js` | T | An "Langue des emails" FR/EN selector on the reservation fiche; `emailLanguage` in the form state + payload. |
| `pages/` | `pages/EmailTemplatesPage.js` (editor dialog) | T | Two extra fields — **Sujet (EN)** + **Corps (EN)** — alongside the French ones, with the same token/flag picker chips. |
| `components/` | `EmailManualSendDialog.js` / preview | — | **No change this PR** — the preview already renders in the reservation's language (server-side). The ad-hoc FR/EN toggle is deferred (rule 3b). |
| `api.js` | `api.js` | — | **No change** — `createReservation`/`updateReservation` already POST the full form (so `emailLanguage` rides along); `create/updateEmailTemplate` POST the editor payload (so `subjectEn`/`bodyEn` ride along); `previewEmail` defaults to the reservation language server-side. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `FormDialog`, the template editor, `StaySection`, MUI `Select`/`ToggleButton` | Reused. |
| **Created (new generic)** | — | None (a small FR/EN `ToggleButtonGroup` may be inlined; extract if a 2nd use appears). |

### 4.3 API contract

| Method | Endpoint | Change |
|---|---|---|
| GET | `/api/emails/preview?reservationId&templateId&lang?` | Optional `lang` override; default = reservation `emailLanguage`. Returns the chosen-language subject/body. |
| POST | `/api/emails/send` | Optional `lang` in the body; same default + fallback. |
| POST/PUT | `/api/email-templates` | Accept + return `subjectEn`/`bodyEn`. |
| POST/PUT | `/api/reservations(/:id)` | Accept `emailLanguage` ∈ {fr,en}. |

---

## 5. Data model

- **`email_templates.subjectEn` TEXT NULL, `bodyEn` TEXT NULL** — additive; NULL = no English version (FR
  fallback on send).
- **`reservations.emailLanguage` TEXT NOT NULL DEFAULT 'fr'** — additive; existing rows backfill to `fr` via
  the DEFAULT clause.
- **Migrations** (idempotent, `database.js`): two `ALTER TABLE … ADD COLUMN` (PRAGMA-guarded) + a content
  migration that writes the registry's `subjectEn`/`bodyEn` onto the `arrival_reminder_7d` /
  `arrival_reminder_1d` rows **only when those columns are NULL/empty**.

**Data impact:** purely additive. No existing French content changed; English is opt-in per template +
per reservation. Default behavior (no English filled, `emailLanguage='fr'`) is byte-identical to today.

## 6. UI / UX

- **Reservation fiche (Séjour section):** a small **"Langue des emails"** FR/EN selector (default FR).
- **Email template editor:** below the French subject/body, **"Sujet (EN)"** + **"Corps (EN)"** fields
  (optional), sharing the existing variable/condition chips. A hint: *« Laissez vide pour envoyer en
  français. »*
- **Preview / send:** the dialog shows the language that will be used (from the reservation) and offers a
  FR/EN toggle to preview/send the other language ad hoc.
- **Copy:** English default bodies are faithful translations of the FR copy (warm tone preserved).
- **Responsive:** the new fields stack on `xs` (full-width); the FR/EN toggle is a compact
  `ToggleButtonGroup`. No table changes.
- **PageActionBar:** unchanged.

## 7. Test plan

### Server unit tests (all green — 1675 total)
- [x] `tests/email-template-language.unit.test.js` (new, +6) — `pickTemplateSide`: EN present → EN; EN empty
  → FR fallback `usedLang='fr'`; partial (EN body, empty EN subject) → EN body + FR subject; `normaliseLang`.
- [x] `tests/email-context-builder.unit.test.js` (extend, +4) — `lang='en'`: dates "10 July 2026", English
  `bedConfig`, `nordicBathReminder` (+ slot), `complementNotice` + "Tourist tax", `propertyWithArticle`
  without the French article; default `fr` unchanged (regression pin).
- [x] `tests/date-fr.unit.test.js` (extend, +1) — `formatDateLong(d,'en')` English month; default/`'fr'` unchanged.
- [x] `tests/default-email-templates-registry.unit.test.js` (extend) — token-check now covers `subjectEn`/
  `bodyEn`; both defaults carry a non-empty English subject+body with the **same `{{#if}}` flags** as FR.
- [x] Boot-verified: fresh install seeds EN; an existing FR-only install backfills `subjectEn`/`bodyEn`
  (FR preserved); an EN context renders the J-2 body fully in English with no missing variables.

### E2E (Playwright — `e2e/specs/emails/email-language-fr-en.spec.js`, +1)
- [x] A reservation defaults to a French J-2 preview; setting it to English flips the preview (body + dates)
  to English with no French leakage; the fiche surfaces the language selector showing "English". Full E2E
  suite green (27).

### Manual UI verification
- [x] Editor shows the EN subject/body fields; chips insert into the focused (FR or EN) field. (E2E renders
  the editor; render verified.)
- [ ] Mobile: fiche selector + editor EN fields usable.

## 8. Out of scope

- Languages beyond FR/EN.
- Auto-detecting the guest language (from country/phone) — the operator sets it.
- Unifying `emailLanguage` with `pdfLanguage` (kept separate for now).
- Translating operator-customised templates automatically (we ship EN for the 2 defaults; operators fill
  their own EN via the editor).
- Localising money/number formats (euro `1 234,56 €` kept in both languages).

## 9. Open questions

Resolved during scoping (2026-06-19):
- **Where is the language chosen?** → Per reservation (`emailLanguage`, like `pdfLanguage`), with an optional
  ad-hoc FR/EN override at preview/send.
- **How are translations stored?** → `subjectEn`/`bodyEn` columns on `email_templates` (one bilingual row).
