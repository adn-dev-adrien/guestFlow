# Client form — free-text address block + drag & drop email / phone

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/client-contact-smart-input` _(Claude-managed)_ |
| **Created** | 2026-08-12 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The client dialog is rendered by the shared component
[`ClientFormFields.jsx`](../client/src/components/ClientFormFields.jsx), consumed by three pages:
[`ClientsPage.jsx:548`](../client/src/pages/ClientsPage.jsx#L548),
[`ReservationPage.jsx:3038`](../client/src/pages/ReservationPage.jsx#L3038) (inline "create client")
and [`EmailTemplatesPage.jsx:483`](../client/src/pages/EmailTemplatesPage.jsx#L483) (preview client).

Two frictions when capturing a client from an external source (platform back-office, an email
signature, the property's own web page):

1. **The address must be re-typed field by field** — `N°`, `Rue / voie`, `Code postal`, `Ville` are four
   separate inputs, while the source always gives one line ("12 rue des Lilas 07000 Privas"). The
   existing **Adresse complète** field ([`ClientFormFields.jsx:73-80`](../client/src/components/ClientFormFields.jsx#L73-L80))
   is `readOnly` — it only mirrors the concatenation, it cannot be used to *enter* an address.
2. **Dragging a contact link from a web page inserts the raw href.** Dropping an email link into the
   **Email** field writes `mailto:jean.dupont@example.com?subject=Contact`, and a phone link writes
   `tel:+33627753922`. Both then fail (or dirty) the format validation of
   [`clientValidation.js`](../server/src/utils/clientValidation.js) / [`validation.js`](../client/src/utils/validation.js),
   and have to be cleaned by hand.

Normalization of client fields is already server-side (`sentenceCase` on street/city/notes in
[`clientsModel.js:43`](../server/src/models/clientsModel.js#L43)), so parsing belongs on the same side.

## 2. Goal

Capture a client's address by pasting/typing **one line** and let the server split it into
number / street / postal code / city, and drop an email or phone link straight from a web page into the
form and get **only** the cleaned value (`jean.dupont@example.com`, `0627753922`) — no manual cleanup.

## 3. Functional rules

### Address block

1. The `readOnly` **Adresse complète** field (currently between *Langue des emails* and *Notes*) is
   removed and replaced by an **editable free-text block** labelled **Adresse (saisie libre)**, placed
   **directly under Nom / Prénom, above** the four detail fields, which stay visible and editable.
   Its value mirrors the concatenation of the four fields whenever they are edited by hand, so it keeps
   the read-only field's former role of showing the address in one line.
2. The block is parsed by the **server** when the user (a) **drops** text on it or (b) **leaves** the
   field (blur) after changing it. Parsing is skipped when the field content is unchanged (no needless
   round-trip on a simple focus/blur).
3. Expected input format, positional, all parts optional except the city:
   `<numéro> <nom de rue> <code postal> <ville>`.
4. **Parsing algorithm** (server, pure function):
   1. Commas, semicolons, newlines and tabs are treated as spaces; runs of whitespace collapse; the
      input is tokenized on spaces.
   2. A trailing country token (`France`, `french`, `FR`, case-insensitive) is dropped.
   3. **Street number** — the first token when it matches 1–4 digits with an optional letter suffix
      (`12`, `12b`, `4A`). A following `bis` / `ter` / `quater` token is absorbed into it (`12 bis`).
      A 5-digit first token is **not** a street number (it is a postal code).
   4. **Postal code** — the first remaining token made of exactly 5 digits. Everything before it is the
      street, everything after it is the city.
   5. **No postal code** — the **last** remaining token is the city, everything before it is the street.
      A single remaining token is the city (street empty).
   6. `street` and `city` are normalized with the existing `sentenceCase` (same rule as a manual entry),
      `streetNumber` and `postalCode` are trimmed as-is.
5. The parse result **replaces** the four detail fields wholesale (the block is authoritative for that
   drop/blur). The user can still correct any field by hand afterwards; typing in a detail field
   re-composes the block content.
6. The block never becomes a stored column: it is a UI-level input, the four columns remain the
   persisted truth.

### Email drop

7. Dropping content on the **Email** field intercepts the drop (the browser's default raw insert is
   prevented) and asks the server for the cleaned address:
   - `mailto:` scheme removed, `?subject=…`-style query removed, percent-encoding decoded;
   - `Jean Dupont <jean.dupont@example.com>` → the address inside the angle brackets;
   - free text (an email signature, a whole paragraph) → the **first** address matched in it;
   - trailing punctuation stripped, result lowercased and trimmed.
8. When nothing email-shaped is found, the raw dropped text (trimmed) is inserted so nothing is lost —
   the existing "Format email invalide" helper then flags it.

### Phone drop

9. Dropping content on the **Téléphone** field is intercepted the same way and cleaned server-side:
   - `tel:` / `callto:` / `sms:` scheme removed, percent-encoding decoded;
   - free text → the first plausible number run (digits, spaces, dots, dashes, parentheses, slashes);
   - spaces and separators removed — the stored value is **compact**;
   - a leading `00` becomes `+` (`0032475123456` → `+32475123456`).
10. **Country code — `+33` only.** The conversion of an international prefix into a national `0` applies
    to **France and nothing else**:
    - `+33` / `0033` → `0` + the national number → `tel:+33627753922` → `0627753922`;
    - **every other country code is preserved as-is**, in compact international form:
      `+32 475 12 34 56` → `+32475123456`, `+41 79 123 45 67` → `+41791234567`,
      `+44 7911 123456` → `+447911123456`, `+49 151 12345678` → `+4915112345678`,
      `+1 (415) 555-0132` → `+14155550132`.
    - The rule is a single explicit `+33` branch — there is no "strip whatever the country code is"
      logic, so a foreign client can never lose its prefix.
11. When nothing phone-shaped is found, the raw dropped text (trimmed) is inserted — the existing
    "Format téléphone invalide" helper flags it.
12. Both fields keep accepting normal typing: manual input is **not** reformatted (only drops are).

**Edge cases:**

- `« 07000 Privas »` → CP `07000`, ville `Privas`, rue et n° vides.
- `« Privas »` → ville `Privas` only.
- `« 12, rue des Lilas, 07000 Privas, France »` → `12` / `Rue des lilas` / `07000` / `Privas`.
- `« 12 rue des Lilas Privas »` (no CP) → `12` / `Rue des lilas` / `` / `Privas`.
- Multi-word city without a postal code (`« rue X Aix en Provence »`) → only `Provence` is taken as the
  city (accepted limitation of the positional format — the fields stay editable).
- Empty / whitespace-only block → the four fields are cleared.
- Foreign number dropped **without** any prefix (a Belgian `0475 12 34 56` typed nationally) → kept as
  `0475123456`, no country code invented. Only an explicit `+`/`00` prefix is interpreted.
- A number that is only an international prefix or too short to be a number (`+33`, `12`) → treated as
  "nothing phone-shaped": the raw text is inserted and the validation helper flags it.
- A drop while the server is unreachable → the field is left untouched and an inline error helper
  ("Analyse impossible") shows for that field until the next successful parse.

---

## 4. Architecture

> **Fat backend, thin frontend.** All three parsers (address splitting, email extraction, phone
> normalization) are pure server functions behind one endpoint. The client only intercepts the drop
> event, ships the raw string, and renders the returned values — no regex, no formatting rule in React.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `clients.js` | T | Adds the thin `POST /clients/parse-contact` route → controller. |
| `controllers/` | `clientsController.js` | T | Adds `parseContact`: validates the body has at least one of `address` / `email` / `phone`, delegates to the util, returns only the requested keys. `400 INVALID_PAYLOAD` otherwise. |
| `models/` | — | — | (none — parsing is stateless, nothing is read or written) |
| `utils/` | `contactParsing.js` | C | **NEW.** Pure, unit-tested: `parseAddressBlock(raw)` → `{ streetNumber, street, postalCode, city }`, `extractEmail(raw)` → string, `extractPhone(raw)` → string. Reuses `sentenceCase` from `textFormatters`. |
| `utils/` | `textFormatters.js` | — | Reused (`sentenceCase`), unchanged. |
| `database.js` | — | — | (none — no schema change) |

**Notes:** no new dependency (no `libphonenumber`; the `+33 → 0` rule is the only country-specific one
and is a two-line branch). The util is framework-free so it can later serve the public booking-request
flow if needed.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `ClientFormFields.jsx` | T | Address block promoted to an editable, droppable field at the top of the address group; drop handlers on Email and Téléphone; calls `api.parseClientContact` and writes the returned values into `form`. Holds only local UI state (the block draft + a per-field "analyse impossible" flag). |
| `components/` | `DroppableTextField.jsx` | C | **NEW generic.** `TextField` wrapper that intercepts `dragover`/`drop`, extracts the dropped payload (`text/uri-list` then `text/plain`), calls `onDropText(raw)` instead of the browser's default insert, and shows a highlighted border while a drag hovers. Purely presentational + event plumbing, no parsing. |
| `pages/` | `ClientsPage.jsx` | — | Unchanged — it already passes `form` / `setForm`; it inherits the behavior. |
| `pages/` | `ReservationPage.jsx` | — | Unchanged, inherits (inline create-client dialog). |
| `pages/` | `EmailTemplatesPage.jsx` | — | Unchanged, inherits (preview client). |
| `api.js` | `api.js` | T | Adds `parseClientContact(payload)` → `POST /clients/parse-contact`. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `FormRow`, `FormDialog`, MUI `TextField` / `Autocomplete` | Unchanged usage. |
| **Created (new generic)** | `DroppableTextField` | Generic on purpose: "a text field that accepts a dropped payload and hands the raw string to a callback" has no client-domain knowledge. Next likely consumers: reservation notes (dropping a platform message), property address in `PropertyDetail`, the devis client block. |
| **Specific (kept feature-local)** | — | The address block itself is three `DroppableTextField` usages inside `ClientFormFields`, not a new component. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| POST | `/clients/parse-contact` | `{ address?: string, email?: string, phone?: string }` | `{ address?: { streetNumber, street, postalCode, city }, email?: string, phone?: string }` | Only the keys present in the request come back. `400 { error: 'INVALID_PAYLOAD' }` when none of the three keys is a string. Stateless, idempotent, no DB access. |

Auth: under the global `requireAuth` guard like every other `/clients` route.

---

## 5. Data model

**No schema change.** The four existing columns (`streetNumber`, `street`, `postalCode`, `city`) plus
the derived `address` column keep their current semantics and are still written by
`clientsModel.buildClientFields`. The free-text block is a UI input only.

**Data impact:** none on existing rows. No migration.

## 6. UI / UX

**Field order in the dialog (confirmed 2026-08-12).** The `readOnly` **Adresse complète** field that
sits today between *Langue des emails* and *Notes* is **removed**; it is reborn as the editable block at
the top of the address group, so the input sits directly above the four fields it fills.

| Before | After |
|---|---|
| Nom / Prénom | Nom / Prénom |
| N° / Rue | **Adresse (saisie libre)** ← input + drop zone |
| CP / Ville | N° / Rue ← filled |
| Email | CP / Ville ← filled |
| Téléphone | Email |
| Langue des emails | Téléphone |
| Adresse complète *(readOnly)* | Langue des emails |
| Notes | Notes |

**Client dialog — address group:**

```
┌──────────────────────────────────────────────────┐
│ Adresse (saisie libre)                           │  ← éditable + zone de dépôt
│ 12 rue des Lilas 07000 Privas                    │
└──────────────────────────────────────────────────┘
  helper: « Dépose ou saisis l'adresse en une ligne : n° rue CP ville »
┌────────┐ ┌───────────────────────────────────────┐
│ N°  12 │ │ Rue / voie   Rue des lilas            │
└────────┘ └───────────────────────────────────────┘
┌──────────────┐ ┌───────────────────────────────────┐
│ CP    07000  │ │ Ville   Privas                    │
└──────────────┘ └───────────────────────────────────┘
```

- **Copy (French):**
  - Block label: `Adresse (saisie libre)`.
  - Block helper: `Dépose ou saisis l'adresse en une ligne : n° rue CP ville`.
  - Email helper on drop failure: `Analyse impossible` (replaces the normal helper until the next parse).
  - Existing labels (`N°`, `Rue / voie`, `Code postal`, `Ville`, `Email`, `Téléphone`) unchanged.
- **Drag feedback:** while a drag hovers a droppable field, its outline switches to `primary.main` and
  the background to a light primary tint; it reverts on drop/leave.
- **Loading state:** the parse round-trip is a single fast POST; the field shows no spinner, but it is
  disabled for the duration of the request to avoid a race between a drop and a manual edit.
- **Error state:** a failed request leaves the field content untouched and shows the
  `Analyse impossible` helper in error colour.
- **Responsive:** the block is full-width at every breakpoint and stacks above the existing `FormRow`s,
  which already collapse to one column on `xs`. Nothing new to stack. Drag & drop is a
  desktop-only gesture by nature; on mobile the block stays a normal editable field parsed on blur, so
  the feature is fully usable on a phone.
- **Sticky action bar:** unchanged — this spec touches a dialog, not a page; `ClientsPage` keeps its
  existing `PageActionBar`.

## 7. Test plan

### Server unit tests — `tests/client-contact-parsing.unit.test.js` (33 cases, all green)
- [x] `parseAddressBlock`: full address; commas; trailing `France`; `12 bis`; letter suffix (`4A`);
      CP-only + city; city-only; no CP (last token = city); multi-word city after a CP; empty/null
      input; 5-digit first token treated as CP not number; `sentenceCase` applied to street/city.
- [x] `extractEmail`: `mailto:` + query; percent-encoded `%40`; `Nom <mail>`; free-text sentence with
      trailing punctuation; subdomain + plus-addressing; uppercase → lowercase; no match → `''`.
- [x] `extractPhone`: `tel:+33627753922` → `0627753922`; `+33 6 27 75 39 22` → same;
      `0033627753922` → same; `+33 (0)6 …` → no doubled trunk zero; `04.75.64.12.34` → `0475641234`;
      free text `« Tél. : 04 75 64 12 34 (accueil) »`; `+33` / `12` / `appelez-nous` → `''`.
- [x] **Foreign numbers keep their country code** (rule 10): `+32 475 12 34 56` → `+32475123456`;
      `0032475123456` → `+32475123456`; `tel:+41791234567`; `+44 7911 123456`; `+49 151 12345678`;
      `+1 (415) 555-0132`; a prefix-less foreign number (`0475 12 34 56`) stays `0475123456`;
      plus a regression guard asserting no `+`-prefixed input other than `+33` ever comes back as `0`.
- [x] Controller `parseContact` (same file, using `buildController`): returns only the requested keys;
      the three keys at once; empty string is a valid request (clears the fields); an unparseable
      email/phone is echoed back rather than swallowed; `400 INVALID_PAYLOAD` on `{}` / `{notes}` /
      `{email: 42}` / no body.
- [x] Full server suite green — **2699** tests.

### Client unit tests (Vitest)
- [x] `client/src/components/__tests__/ClientFormFields.test.jsx` (7 cases) — dropping `mailto:…` on
      Email sends the raw payload and writes the cleaned value; dropping `tel:…` on Téléphone likewise;
      a dropped `text/uri-list` wins over `text/plain`; typing + blurring the block fills the four
      fields and the block mirrors them; blurring an unchanged block does **not** call the API; editing
      a detail field by hand recomposes the block with no API call; a failed parse leaves the field
      untouched and shows `Analyse impossible`.
- [x] Full client suite green — **871** tests / 112 files.

### E2E (Playwright)
- [x] Existing suite still green (`npm run test:e2e`) — 58 passed, 1 skipped.

### Manual UI verification (real browser, dev server)
- [x] Typing `12 rue des Lilas 07000 Privas` in the block + Tab → `12` / `Rue des lilas` / `07000` /
      `Privas`, block re-rendered normalized as `12 Rue des lilas 07000 Privas`.
- [x] Dropping `mailto:Jean.Dupont@Example.com?subject=Contact%20site` on **Email** → only
      `jean.dupont@example.com`.
- [x] Dropping `tel:+33627753922` on **Téléphone** → `0627753922`.
- [x] Dropping `« Tél. Belgique : +32 475 12 34 56 »` → `+32475123456` (prefix kept).
- [x] Save + reopen the client → the four columns persisted, block recomposed from them.
- [x] Same dialog from `ReservationPage` (inline create client): dropping
      `8 bis avenue de la Gare 07200 Aubenas France` on the block → `8 bis` / `Avenue de la gare` /
      `07200` / `Aubenas`, and `tel:+33…` on the phone → `0627753922`.
- [x] Mobile (390×844): block full width, fields stacked, **no horizontal scroll**
      (`scrollWidth === clientWidth === 390`).
- [x] No console error raised by the feature (the only console noise pre-dates the run: a 404 upload
      and `auth/me` 401 probes).

## 8. Out of scope

- Address autocompletion / geocoding (BAN, Google Places) — purely local parsing here.
- Any country other than France for the address format (no `country` column exists).
- A phone-number library (`libphonenumber-js`) and per-country formatting rules beyond `+33`.
- Re-formatting **existing** stored phone numbers (no backfill migration) or manually typed input.
- Extending the drop behavior to other forms (properties, reservations) — `DroppableTextField` is
  written to be reusable, but no other page is wired in this spec.
- `sentenceCase` casing quirks on compound city names (`Saint-étienne`) — pre-existing behavior,
  unchanged here.

## 9. Open questions

### Resolved (2026-08-12, at spec kick-off)
- Q: Free-text block vs. the four fields? **A: block editable at the top, four fields stay visible and
  editable** (option A of the questionnaire).
- Q: Where does the free-text block live in the dialog? **A: at the top of the address group, right
  under Nom / Prénom** — the former `readOnly` "Adresse complète" field at the bottom is removed and
  becomes this input.
- Q: Phone format? **A: compact national** — `tel:+33627753922` → `0627753922`; foreign numbers stay
  compact international.
- Q: Splitting when the postal code is missing? **A: positional — the last token is the city.**
- Q: Which gestures trigger the extraction? **A: drag & drop** (no paste interception, no reformatting
  of manual typing). The address block additionally parses on blur, since a block that is only parsed
  on drop would be unusable when typed by hand or on mobile.
