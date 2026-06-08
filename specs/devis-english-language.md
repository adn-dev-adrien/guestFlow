# Devis — bilingual PDF (FR / EN)

| Field | Value |
|---|---|
| **Status** | Approved |
| **Branch** | `feature/devis-en-translation` _(Claude-managed)_ |
| **Created** | 2026-06-06 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Adrien receives quote requests from foreign customers and currently can only generate the PDF
in French. [`server/src/utils/devisPdf.js`](../server/src/utils/devisPdf.js) hard-codes ~50
French strings (`DEVIS`, `CLIENT`, `DÉTAIL DU SÉJOUR`, `Hébergement — N nuit(s)`, `RÉDUCTION
LOGEMENT N%`, `OFFERT`, `Acompte`, `Solde`, `Caution`, `MODALITÉS DE RÈGLEMENT`,
`COORDONNÉES BANCAIRES`, footer, …) plus French dates via `formatDateFR` from
[`devisHelpers.js`](../server/src/utils/devisHelpers.js#L10-L14). The line items themselves
display the option's `title` and the resource's `name` — also French because the operator
typed them in French.

The PDF generation pipeline:
- Route [`server/src/routes/devis.js:13`](../server/src/routes/devis.js#L13) → controller
  [`devisController.pdf()`](../server/src/controllers/devisController.js#L75-L127) → renderer
  [`generateDevisPdf(full, settings, quote)`](../server/src/utils/devisPdf.js#L31) returning
  a PDF Buffer.
- No language parameter exists anywhere on this path today.

## 2. Goal

The operator can choose the language of the generated PDF (French or English) on each devis,
and the entire PDF — labels, dates, accommodation/option/resource line names, conditions,
footer — renders in the chosen language. Existing French devis stay French unless explicitly
switched.

## 3. Functional rules

1. **Per-devis language field.** Every devis row carries a `pdfLanguage` column with two
   allowed values: `'fr'` (default) and `'en'`. Set via the existing devis edit page; saved
   alongside the rest of the devis fields; persisted across PDF re-generations.
2. **Translated static labels.** Every literal French string the PDF prints today has an
   English counterpart in a single source-of-truth module
   `utils/devisPdfLabels.js`. The renderer reads via `labels(language).<key>` so a missing
   key fails loudly in tests instead of silently leaking French.
3. **Translated dates.** French keeps the existing numeric format `dd/mm/yyyy` (e.g.
   `05/06/2026`). English uses `D MMMM YYYY` with full English month names (e.g.
   `5 June 2026`) — unambiguous internationally, unlike numeric `dd/mm/yyyy` which a US
   reader could mis-parse as month-first. A `formatDateLocalised(iso, language)` helper
   routes to the right one.
4. **Translated accommodation line.** `Hébergement — N nuit(s) (season)` becomes
   `Accommodation — N night(s) (season)` in EN. The season label is the property's pricing
   season name — typed by the operator in French in current setups; **out of scope** for the
   spec (the operator can rename their seasons separately if they want them in English).
5. **Translated discount / offered badges.**
   - `RÉDUCTION LOGEMENT N%` → `ACCOMMODATION DISCOUNT N%`.
   - `OFFERT` → `INCLUDED`.
6. **Translated options — title only.** Each row in `options` gets a single new column:
   `titleEn` (string, default `''`). The option's `description` is intentionally NOT
   translated — it never appears in the devis PDF, only the title does, so a `descriptionEn`
   would be dead weight. The PDF renderer uses `titleEn` when `language === 'en'`; if it's
   empty, falls back to `title` (the French original). The **5 typed-default options** are
   seeded with their English translation so a fresh install lands with `titleEn` populated:
   - `autoOptionType = 'bed_linen'` → `Bed linen`
   - `autoOptionType = 'bathroom_linen'` → `Bath linen`
   - `autoOptionType = 'breakfast'` → `Breakfast`
   - `autoOptionType = 'early_check_in'` → `Early check-in`
   - `autoOptionType = 'late_check_out'` → `Late check-out`

   On every boot, a backfill (idempotent, only touches rows where `titleEn` is empty) updates
   the matching prod rows that pre-date this column. The operator fills `titleEn` for custom
   options via the existing options form.
7. **Translated resources.** Same shape: `resources.nameEn` column (default `''`), used
   when `language === 'en'`, falls back to `name`. The default "Lit bébé" seed gains
   `nameEn = 'Baby bed'`. Operators translate their custom resources via the form.
8. **Translated early/late check-in suffix.** `(N heures suppl.)` in the option label becomes
   `(N extra hour(s))` in EN.
9. **Translated tax line.** `${N} pers. × ${M} nuit${s} × ${rate} / pers./nuit` becomes
   `${N} guest(s) × ${M} night(s) × ${rate} / guest / night`.
10. **Translated deposit/balance/caution rows.** `Acompte`, `À payer avant le DATE`, `Solde`,
    `Caution`, ` — à remettre le jour de votre arrivée` → `Deposit`, `Due before DATE`,
    `Balance`, `Security deposit`, ` — payable on arrival`.
11. **Translated footer.** The settings-stored `pdfFooterText` is a single French string
    today. We add a second setting `pdfFooterTextEn` that the operator fills in
    `/settings`; when `language === 'en'` the PDF uses `pdfFooterTextEn` if non-empty, else
    a sensible English default ("We thank you for your interest and remain at your disposal
    for any further information. We look forward to your confirmation. Have a great day.").
12. **The PDF endpoint signature does not change.** `GET /api/devis/:id/pdf` keeps reading
    `pdfLanguage` from the devis row. No query parameter, no body change. Devis whose
    `pdfLanguage === 'en'` always download the English version; switching back to FR is a
    one-click toggle on the devis form.

**Edge cases:**
- **Existing devis pre-migration:** every existing row gets `pdfLanguage = 'fr'` (migration
  default), so legacy PDF downloads are byte-stable.
- **Empty `titleEn` / `nameEn` on a referenced option/resource:** silent fall back to the
  French label. The PDF stays usable; the operator sees the French word in an otherwise
  English PDF and can fix it.
- **Option `description` is never translated.** It's not printed in the devis PDF (only the
  title is), so we don't carry a `descriptionEn`. A future PR that decides to print the
  description in the PDF should add the column at that time, not pre-emptively.
- **Empty `pdfFooterTextEn` on a setting:** fall back to the hard-coded English default.
- **Operator switches an existing devis from FR to EN before filling translations:** the PDF
  renders English labels with French option/resource names. That's an acceptable
  intermediate state — the alternative (blocking the download) would frustrate users for a
  cosmetic concern.

---

## 4. Architecture

> **Fat backend, thin frontend.** All translation logic, label maps, locale-aware date
> formatting and option/resource fallback live on the server. The client only ships the
> chosen language as a string and renders text inputs for translations on the options +
> resources forms.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `devis.js` | — | Endpoint unchanged. |
| `routes/` | `options.js` | T | Accept `titleEn` / `descriptionEn` in POST/PUT body. |
| `routes/` | `resources.js` | T | Accept `nameEn` in POST/PUT body. |
| `routes/` | `settings.js` | T | Accept `pdfFooterTextEn` (alongside `pdfFooterText`). |
| `controllers/` | `devisController.js` | T | Read `pdfLanguage` from the devis row + pass it to `generateDevisPdf`. Default to `'fr'` when null/unknown. |
| `controllers/` | `optionsController.js` (if present, else inline route) | T | Write `titleEn`/`descriptionEn` on create/update. |
| `controllers/` | `resourcesController.js` (if present, else inline) | T | Write `nameEn` on create/update. |
| `models/` | — | — | (no new model; existing CRUD reads the new columns through `SELECT *` already). |
| `utils/` | `devisPdf.js` | T | Accept `language` arg; replace every hard-coded French literal with `labels(language).<key>`; route option/resource label through a small fallback helper. |
| `utils/` | `devisPdfLabels.js` | C | NEW. Exports `{ fr: {...}, en: {...} }` for every PDF string + a `labels(language)` accessor that throws on unknown language (fail-loud). |
| `utils/` | `devisHelpers.js` | T | Add `formatDateEN(isoDate)` (English month names). Keep `formatDateFR`. |
| `utils/` | `bedLinenSeed.js` | T | Seed/insert `titleEn = 'Bed linen'`. Promotion path also sets `titleEn` if currently empty. |
| `utils/` | `bathroomLinenSeed.js` | T | Same for `titleEn = 'Bath linen'`. |
| `utils/` | `breakfastSeed.js` | T | Same for `titleEn = 'Breakfast'`. |
| `database.js` | `database.js` | T | Idempotent migration: add `pdfLanguage TEXT NOT NULL DEFAULT 'fr'` to reservations; `titleEn TEXT DEFAULT ''` to options; `nameEn TEXT DEFAULT ''` to resources. Seed the "Lit bébé" default resource with `nameEn = 'Baby bed'`. The per-property `ensureDefaultTimedOptionsForProperty` seeds `Early check-in` / `Late check-out` + backfills existing rows. |

**Notes:**
- `devisPdfLabels.js` is pure data + a tiny accessor — fully unit-testable.
- Reuse the existing `tryAddOptionColumn` helper pattern that already lives in
  `database.js` to add the new option columns idempotently.
- The settings table is single-row key/value style — no migration needed beyond accepting
  the new `pdfFooterTextEn` key.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `ReservationPage.js` | T | When `isDevisMode`, show a FR/EN segmented toggle next to the devis number; bind to `form.pdfLanguage`; default `'fr'` for new devis. Include in payload on save. |
| `pages/` | `OptionsPage.js` | T | In the option create/edit dialog, add `Titre (anglais)` `TextField` + `Description (anglais)` `TextField` below the FR equivalents. |
| `pages/` | `ResourcesPage.js` | T | In the resource create/edit dialog, add `Nom (anglais)` `TextField` below the FR field. |
| `pages/` | `SettingsPage.js` | T | Add the `pdfFooterTextEn` field below `pdfFooterText`. |
| `api.js` | `api.js` | — | No change — the PDF endpoint signature is unchanged. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `FormDialog`, `TextField`, `ToggleButtonGroup` (MUI) | Reused. The language toggle is a tiny MUI ToggleButtonGroup — no new component warranted yet. |
| **Created (new generic)** | (none) | A `<LanguagePicker>` could be factored later if a second consumer appears; today the devis is the only one. |
| **Specific (kept feature-local)** | (none) | All UI fragments are simple TextField additions or an inline ToggleButtonGroup. |

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/devis/:id/pdf` | — | PDF bytes | Unchanged shape. Server reads `pdfLanguage` from the devis row. |
| PUT/POST | `/api/devis/...` | adds `pdfLanguage` to body | unchanged | New optional field, defaults to `'fr'`. Validates `'fr'\|'en'` — 400 on other values. |
| PUT/POST | `/api/options/...` | adds `titleEn` | unchanged | Optional string, trimmed server-side. `descriptionEn` is deliberately NOT in the payload (description isn't printed in the PDF). |
| PUT/POST | `/api/resources/...` | adds `nameEn` | unchanged | Optional string, trimmed server-side. |
| PUT | `/api/settings` | adds `pdfFooterTextEn` | unchanged | Optional. |

Auth: all under the existing global `requireAuth` (unchanged).

---

## 5. Data model

Three idempotent migrations in `database.js`:

1. `reservations.pdfLanguage TEXT NOT NULL DEFAULT 'fr'` — added via the existing
   `if (!cols.includes(...))` pattern around that table. Existing rows backfill to `'fr'`
   via the DEFAULT clause.
2. `options.titleEn TEXT NOT NULL DEFAULT ''` — added via `tryAddOptionColumn` (already used
   for the other late additions). Existing rows get `''`. **No `descriptionEn`**: the option
   description isn't printed in the devis PDF, so a translation column would be dead weight.
3. `resources.nameEn TEXT DEFAULT ''` — added the same way.

**Backfill for the typed-default seeds:** the 3 seed scripts (`bedLinenSeed`,
`bathroomLinenSeed`, `breakfastSeed`) gain a promotion path that, in addition to the existing
`autoOptionType` upgrade, sets `titleEn = 'Bed linen' | 'Bath linen' | 'Breakfast'` when the
matching row has empty `titleEn`. This catches both fresh installs (the seed insert) and
prod servers that already promoted (the typed marker exists but the EN column is empty).

**Data impact:** no row loss, no data rewrite of existing French content. The migration is
purely additive. Drop-irreversible columns added; the spec is intentional about that.
Documented as a `Migration` note in `CHANGELOG.md`.

## 6. UI / UX

### 6.1 Devis edit page (`ReservationPage` in `mode=devis`)

A small MUI `ToggleButtonGroup` titled **Langue du devis** sits beside the devis number /
status fields in the existing devis header strip:

```
┌──────────────────────────────────────────────────────────────┐
│ N° DEVIS-2026-006   Statut: [Brouillon ▾]   Langue: [FR][EN] │
└──────────────────────────────────────────────────────────────┘
```

- Default `FR` for a fresh devis.
- Two buttons; one is always selected (no null state).
- Clicking marks the form dirty (the existing "unsaved changes" guard catches it).
- The downloaded PDF reflects the saved language — no per-download picker.

### 6.2 Options edit dialog (`OptionsPage`)

One new field below the existing French ones:

```
Titre*           [ Linge de toilette                    ]
Titre (anglais)  [ Bath linen                           ]
Description      [ Optional…                            ]
```

- Optional. Stored trimmed. Placeholder copy in EN. The description has no EN counterpart
  because the option description isn't printed in the devis PDF.

### 6.3 Resources edit dialog (`ResourcesPage`)

```
Nom*           [ Lit bébé                                ]
Nom (anglais)  [ Baby bed                                ]
```

### 6.4 Settings (`SettingsPage`)

Two stacked multi-line TextFields, French above English:

```
Pied de page du devis (français)
[ Nous vous remercions de votre intérêt …               ]

Pied de page du devis (anglais)
[ We thank you for your interest …                      ]
```

### 6.5 Responsive

- The devis header strip: on `xs` the segmented language toggle stacks under the devis
  number/status (already an `xs={12} sm={...}` layout in the existing strip).
- Options + Resources dialogs: existing `FormDialog` fills the screen on `xs`. The EN
  TextFields render below the FR ones — no horizontal pressure.
- Settings: two stacked TextFields — no responsive concern beyond what already works.

---

## 7. Test plan

### Server unit tests
- [ ] `tests/devis-pdf-labels.unit.test.js` — every key present in BOTH `fr` and `en` maps
      (parity); `labels('fr').X === <french>`; `labels('en').X === <english>`;
      `labels('xx')` throws.
- [ ] `tests/devis-pdf-en.unit.test.js` — render a devis with `pdfLanguage='en'` + options
      that have `titleEn` set + a resource that doesn't (fallback to FR `name`). Assert:
      PDF buffer non-empty; EN labels appear in the decompressed text stream (best-effort
      grep for `QUOTE`, `Accommodation —`, `Deposit`, `Balance`, `INCLUDED`); FR fallback
      visible for the un-translated resource.
- [ ] `tests/devis-helpers-date-en.unit.test.js` — `formatDateEN('2026-06-05')`,
      `'2026-12-25'`, ISO edge `'2026-01-01'`, empty string returns `''`.
- [ ] `tests/options-resources-en-fields.unit.test.js` — POST/PUT persists `titleEn` trimmed
      + preserves operator-chosen EN casing; payload `descriptionEn` is silently ignored
      (column intentionally absent).
- [ ] `tests/resources-controller-en.unit.test.js` — POST/PUT persists `nameEn` trimmed.
- [ ] `tests/devis-controller-language.unit.test.js` — PUT /devis with valid
      `pdfLanguage='en'` persists; `'xx'` → 400; default `'fr'` on creation.
- [ ] `tests/seeds-en-translation.unit.test.js` — the 3 typed-default seeds (bed_linen,
      bathroom_linen, breakfast) insert + backfill `titleEn`; idempotent across multiple
      runs. A "no descriptionEn anywhere" guard makes a future regression fail loud.
- [ ] `tests/timed-options-en-seed.unit.test.js` — `early_check_in` and `late_check_out`
      seed with the right EN title (`Early check-in` / `Late check-out`) + backfill
      existing rows + operator override preserved + idempotent.
- [ ] Full server suite remains green.

### Client tests (Vitest)
- [ ] `client/src/pages/__tests__/ReservationPage.devis-language.test.js` —
      mount in devis mode with `pdfLanguage='fr'` → FR button selected; click EN → form
      dirty + payload on save includes `pdfLanguage: 'en'`.
- [ ] `client/src/pages/__tests__/OptionsPage.en-fields.test.js` — open the new-option
      dialog → both EN TextFields present; submit payload carries `titleEn` +
      `descriptionEn` (trimmed).
- [ ] `client/src/pages/__tests__/ResourcesPage.en-field.test.js` — same for `nameEn`.

### Manual UI verification
- [ ] Create a new devis → toggle to EN → save → download PDF → header shows `QUOTE N° …`;
      every label is English; date is `5 June 2026`.
- [ ] Edit "Linge de lit" option → confirm `Titre (anglais) = Bed linen` is pre-filled.
- [ ] Custom option without `titleEn` → EN PDF shows the French title (graceful fallback).
- [ ] Toggle the same devis back to FR → re-download → PDF matches the original FR layout
      byte-for-byte (no regression on existing flow).
- [ ] Mobile (`xs`): the language toggle stacks readably under the devis number.

## 8. Out of scope

- Translating **season labels** typed by the operator (e.g. `Haute saison`). The operator
  can rename them separately or accept the FR label in the EN PDF.
- Translating **client notes** typed inside the devis — free-form operator text, stays
  as-typed.
- A third language. The label map is structured so adding `de` / `es` is a future PR (new
  key in the map + a third toggle button), but not in this spec.
- An invoice (`facture`) translation. Devis only for this PR.
- Per-client default language (the spec is per-devis). If repeated foreign clients become
  common, we add a `clients.preferredLanguage` field later that auto-fills the devis toggle.

## 9. Open questions

(Resolved before moving Status to Approved.)

- Q: Where does the language live — per-devis column or URL query param?
  - A: Per-devis column. Auditable, persistent across re-downloads, no risk of accidentally
    sending the wrong language. URL override deferred until a clear need.
- Q: Translate operator's options/resources via column or static map?
  - A: Column. The user explicitly required "tout doit être traduit, y compris options et
    ressources" — a static map can't cover custom options. The 3 typed defaults are
    pre-seeded; custom options/resources get a form field the operator fills.
- Q: Default for fresh devis?
  - A: `'fr'`. Adrien's base market is FR; the EN toggle is opt-in for foreign customers.
