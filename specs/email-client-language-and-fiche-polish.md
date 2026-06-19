# Email language on the client + bilingual option names + reservation-fiche polish

| Field | Value |
|---|---|
| **Status** | Approved |
| **Branch** | `feature/email-client-language-and-fiche-polish` _(user-managed)_ |
| **Created** | 2026-06-19 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The bilingual-email feature (`specs/email-language-fr-en.md`) stores the email language on the
**reservation** (`reservations.emailLanguage`), with a selector on the reservation fiche. In practice a
guest's language is a property of the **person**, not of one stay — so it should live on the client and
drive *every* communication with them.

Two more gaps surfaced:
- **Option / resource names stay French in an English email.** `emailContextBuilder` builds
  `optionsList` / `reservedOptionsList` / `resourcesList` from `options.title` / `resources.name` only.
  Both tables already carry an English column (`titleEn` / `nameEn`, shipped for the bilingual devis PDF)
  with editor fields — the email pipeline just doesn't use them.
- **Reservation fiche polish.** The selected-client block is visually flat; and on a wide screen the
  Logement select and the reservation number sit on two rows, wasting space.

## 2. Goal

The guest's email language is set **once on the client fiche** and drives every email for that client.
Emails rendered in English show **English option/resource names** (falling back to French when no English
name is set). The reservation fiche gets a **highlighted client card** and puts **Logement + reservation
number on one row** on wide screens (the now-redundant email-language selector is removed from the fiche).

## 3. Functional rules

### Client language

1. New column `clients.emailLanguage` ∈ {`fr`, `en`}, default `fr`, editable on the client fiche.
2. The email pipeline (preview, manual send, auto-send) resolves the language from **the client**:
   `client.emailLanguage` → (fallback) `reservation.emailLanguage` → `fr`. An explicit `lang` API override
   still wins (unchanged). The reservation column is kept as a transitional fallback (not deleted).
3. The **email-language selector is removed from the reservation fiche** (StaySection). The reservation
   `emailLanguage` is no longer written from the fiche; existing values stay as fallback data.

### Bilingual option / resource names

4. When the resolved language is `en`, `optionsList` / `reservedOptionsList` use `option.titleEn` and
   `resourcesList` uses `resource.nameEn` — each **falling back to the French `title` / `name` when the
   English value is empty** (so a half-translated catalog never blanks an item). For `fr`, unchanged.
5. The email option/resource loaders (`emailsController.loadReservationGraph`, `emailAutoSendRunner`) select
   `titleEn` / `nameEn` alongside `title` / `name`.
6. Custom (free-text, per-reservation) options are out of scope — they have no English variant and stay as
   typed. (They don't appear in `optionsList`/`resourcesList`.)

### Reservation-fiche polish

7. The selected-client block becomes a **highlighted card** (subtle colored background + border, harmonious
   with the app theme), keeping its click-to-edit behavior and the person + edit icons.
8. On `md+`, **Logement** and **Numéro de réservation** render on the **same row** (two columns); on `xs`
   they stack. Devis (no reservation number) keep a single full-width Logement select.

**Edge cases:**
- Client with no language → `fr` (column default).
- A reservation whose client predates the column → `fr` (default), unless the old `reservation.emailLanguage`
  fallback says otherwise.
- Option with an empty `titleEn` in an EN email → its French `title` is used (no blank, no `()` artefact).
- Devis fiche → no reservation-number field, no language selector; Logement stays full-width.

---

## 4. Architecture

> **Fat backend, thin frontend.** Language resolution + name selection stay server-side; the client moves
> a selector from one form to another and restyles a card.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` | `database.js` | T | Idempotent `ALTER TABLE clients ADD COLUMN emailLanguage TEXT NOT NULL DEFAULT 'fr'`. |
| `models/` | `models/clientsModel.js` | T | Persist + return `emailLanguage` (whitelist + INSERT/UPDATE), normalised to `fr`/`en`. |
| `utils/` | `utils/emailContextBuilder.js` | T | `optionsList` / `reservedOptionsList` pick `titleEn` (EN, fallback `title`); `resourcesList` picks `nameEn` (EN, fallback `name`). FR unchanged. |
| `controllers/` | `controllers/emailsController.js` | T | `buildPreview`: resolve `useLang` from `graph.client?.emailLanguage` first (then reservation, then fr). `loadReservationGraph`: select `o.titleEn`, `res.nameEn`. The acknowledge/markSent snapshots use the same client-language resolution. |
| `utils/` | `utils/emailAutoSendRunner.js` | T | Resolve `lang` from `client?.emailLanguage` (fallback reservation, fr). Option/resource SELECTs add `titleEn` / `nameEn`. |
| `controllers/` | `controllers/clientsController.js` | — | No change (the model owns persisted fields; validation already passes the payload). |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `components/ClientFormFields.js` | T | Add a **"Langue des emails"** FR/EN select. |
| `pages/` | `pages/ClientsPage.js` | T | `emptyClient` + save payload include `emailLanguage`; load it when editing. |
| `components/` | `components/reservation/StaySection.js` | T | Remove the email-language selector; wrap Logement + reservation number in a 1-col(xs)/2-col(md) grid. |
| `pages/` | `pages/ReservationPage.js` | T | Drop `emailLanguage` from the reservation form state + payloads (no longer fiche-driven). Restyle the selected-client card (colored background + border). |
| `api.js` | `api.js` | — | No change — client create/update already POST the full form (so `emailLanguage` rides along). |

**Component reuse declaration:** consumes existing `FormDialog`, `ClientFormFields`, MUI `Select`/`Card`.
No new generic component (the client card stays a feature-local `Box`/`Card`).

### 4.3 API contract

No new endpoints. `POST/PUT /api/clients(/:id)` accept + return `emailLanguage`. Email preview/send
unchanged in signature (the default language source moves from reservation to client, server-side).

## 5. Data model

- **`clients.emailLanguage`** TEXT NOT NULL DEFAULT 'fr' — additive; existing rows backfill to `fr`.
- **`reservations.emailLanguage`** — unchanged, kept as a transitional fallback (no migration, not removed).
- **`options.titleEn` / `resources.nameEn`** — already exist; now also read by the email pipeline.

**Data impact:** one additive column. No data loss. Default behavior (everyone `fr`, no English names)
is identical to today.

## 6. UI / UX

- **Client fiche:** a "Langue des emails" FR/EN select among the client fields (default Français).
- **Reservation fiche — client card:** the attached-client block gets a soft tinted background + thin
  border + rounded corners (harmonious with the theme), retaining the person icon, bold name, edit icon,
  and click-to-edit. Hover slightly deepens the tint.
- **Reservation fiche — Stay section:** Logement + Numéro de réservation share one row on `md+`, stack on
  `xs`. The email-language selector is gone.
- **Responsive:** the 2-col row collapses to 1 col on `xs`; the client card is full-width-fit on all sizes.
- **Copy:** select labels "Langue des emails" / "Français" / "English".

## 7. Test plan

### Server unit tests
- [ ] `tests/email-context-builder.unit.test.js` (extend) — `lang='en'`: `optionsList`/`reservedOptionsList`
  use `titleEn`, `resourcesList` uses `nameEn`; empty English value falls back to the French name; `fr`
  unchanged.
- [ ] `tests/clients-model` (extend/new) — `emailLanguage` persisted + normalised (`en`/`fr`, junk → `fr`).
- [ ] `tests/emails-controller` / `email-auto-send-runner` — language resolved from the client (then
  reservation fallback, then fr); EN render uses English option names.

### Manual UI verification
- [ ] Set a client to English → its reservations' J-7/J-2 preview is English **including option/resource names**.
- [ ] An option with no `titleEn` → French name shown inside the otherwise-English email.
- [ ] Client default (fr) → unchanged.
- [ ] Reservation fiche: client card is highlighted; Logement + number share a row on desktop, stack on mobile.
- [ ] The email-language selector no longer appears on the reservation fiche.

### E2E (Playwright)
- [ ] Set a client's language to English (client fiche or seed); preview the J-2 reminder for that client's
  reservation → English body + an English option name (seed an option with a `titleEn`).

## 8. Out of scope

- Removing `reservations.emailLanguage` (kept as fallback; a later cleanup can drop it).
- Translating **custom/free-text** options (no English variant exists).
- Languages beyond FR/EN.
- The ad-hoc FR/EN preview toggle (still deferred, per `email-language-fr-en.md`).

## 9. Open questions

Resolved during scoping (2026-06-19):
- **Where does the language live?** → On the **client** (`clients.emailLanguage`); removed from the
  reservation fiche; reservation column kept as fallback.
- **How are option names translated?** → Reuse the existing `options.titleEn` / `resources.nameEn`
  (fallback to French when empty).
