# Settings (Paramètres : Société + Devis + Google Calendar)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/settings-redesign` _(user-managed)_ |
| **Created** | 2026-05-24 |
| **Author** | Adrien |
| **Spec type** | Retro-spec + MVC refactor + UX humanization |

---

## 1. Context

The "Paramètres" page (`client/src/pages/SettingsPage.js`, 596 LOC) holds three groups of settings: **Société** (company identity + bank + logo, used as PDF devis header/footer), **Devis** (default validity in days, footer text), and **Google Calendar** (sync credentials).

What's wrong today:
- Backend (`routes/settings.js`, 126 LOC) does everything inline: no validation, no MVC, private key returned in clear text.
- Page is a 596-LOC monolith with inline sticky bar (duplicated from `ReservationPage.js`), inline dirty-state + nav-guard logic, inline logo upload.
- **Labels are too technical** for a non-developer user: "Service Account Private Key", "Numéro de TVA intracommunautaire", "BIC". No helpers, no help links.
- No way to verify Google credentials without going to Réservations and clicking "Sync Google".

This is the first retro-spec of Bloc 1 and ratifies the shared component library: `PageActionBar`, `MaskedTextField`, `HelpedTextField`, `LogoUpload`, `useDirtyFormGuard` (the last two created in this spec).

## 2. Goal

A simpler, more human Paramètres page where the user can:

1. **Fill in their company identity** (logo + name + address + contacts + SIRET + TVA + bank) — every field with a plain-language label and, where it helps, a short helper text or an external help link.
2. **Tweak quote defaults** (validity, footer).
3. **Configure Google Calendar sync** — with the private key hidden by default, and a **"Tester la synchronisation"** button to verify in one click.

UX kept simple: **one page, three cards stacked, all fields editable inline**, with a sticky `PageActionBar` (Save + Cancel) at the top. No dialogs to navigate, no wizard, no tiles — just clearer language and better helpers.

## 3. Functional rules

### General
1. Single singleton row in `app_settings` (id=1).
2. Save sends the **dirty fields only**, grouped per section (`company`, `quote`, `googleCalendar`). Absent groups/fields → preserved server-side.
3. Save and Cancel in the sticky bar are disabled unless the form is dirty.
4. Navigation away with unsaved changes → confirm dialog "Quitter sans enregistrer ?". This guards both internal navigation (sidebar) and tab close/reload (`beforeunload`).
5. Save success → reload settings from server, dirty state cleared.
6. Save failure with `400 SETTINGS_INVALID` → field-level errors shown under each affected input, page stays dirty.

### Société (Informations sur votre activité)
7. All fields optional. The form can be entirely empty without blocking save.
8. Logo: image upload (PNG/JPEG/WEBP, ≤2 MB). Stored as `server/uploads/company-logo.<ext>`; path persisted as `companyLogoPath`. Delete removes the file from disk and clears the path. Logo upload/delete commit immediately (independent of the Save button).
9. **Server-side validation** when non-empty:
    - Email → basic email regex.
    - SIRET → exactly 14 digits (whitespace tolerated, stripped before validation).
    - TVA → `^[A-Z]{2}\d+$` (intracom format).
    - IBAN → mod-97 check after whitespace removal.
    - BIC → `^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$` (8 or 11 chars).

### Devis (Paramètres des devis)
10. `quoteValidityDays`: integer 1–365 (default 30), validated server-side.
11. `quoteFooterText`: free multiline text. No validation.

### Google Calendar (Synchronisation avec Google Agenda)
12. Three fields: `calendarId`, `serviceAccountEmail`, `privateKey`. All three required for sync.
13. **Private key** stored encrypted at rest is **out of scope** here (deferred to `[[settings-encryption]]` spec). For now: returned masked on GET, never echoed in clear.
14. **GET response shape:** the section returns `calendarId`, `serviceAccountEmail` (raw, for the form to pre-fill), `serviceAccountEmailMasked` (truncated middle, for display elsewhere), `privateKeyMasked` (`"••••••••••" | ""`), `privateKeyFingerprint` (`<sha256-first-6-hex> | null`), `configured` (boolean), `statusLabel` (`"Synchronisation active" | "Configuration en cours" | "Synchronisation non configurée" | "Échec de la dernière synchro"`).
15. **PUT 3-way semantics on `privateKey`:** absent/undefined → preserve; `""` → clear; non-empty string → validate (permissive PEM regex) + store.
16. **Test connection action** (`POST /api/google-calendar/test-connection`): uses stored credentials, calls `calendar.calendars.get(calendarId)`, maps Google errors to friendly French messages:
    - 200 `{ ok: true, message: "Connexion réussie. Agenda « <name> » accessible." }`
    - 400 `{ ok: false, code: 'NOT_CONFIGURED' | 'INVALID_CREDENTIALS' | 'FORBIDDEN' | 'CALENDAR_NOT_FOUND', error: "..." }`
    - 500 `{ ok: false, code: 'UNKNOWN', error: "..." }`
17. `routes/googleCalendar.js` is **not** fully refactored here (deferred to Bloc 6) — only the new `test-connection` route gets a thin controller. Existing `/status` and `/sync-reservations` keep using the extracted `getGoogleCalendarConfig` helper.

## 4. Architecture

> **Reminder — Fat backend, thin frontend.** All business logic, validation, masking, status derivation lives on the server.

### 4.1 Server side (`server/src/`)

#### Target state

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `routes/settings.js` | T | T | **Thin**: 4 routes wired to controllers. |
| `routes/googleCalendar.js` | T | T | Adds `POST /test-connection` (thin → controller). Existing routes untouched (Bloc 6). |
| `controllers/settingsController.js` | C | C | `getSettings`, `updateSettings`, `uploadLogo`, `deleteLogo`. |
| `controllers/googleCalendarController.js` | C | C | Only `testConnection`. |
| `models/settingsModel.js` | C | C | `read()`, `upsert(payload)`, `updateLogoPath(path)`. Factory `(db) => {...}` for testability. |
| `middleware/multerLogoUpload.js` | C | C | Multer config (2 MB, image MIME only). |
| `utils/settingsValidation.js` | C | C | Pure validators: `validateEmail`, `validateSiret`, `validateTvaIntracom`, `validateIban`, `validateBic`, `validatePrivateKey`, `validateQuoteValidityDays`. Return `null` (valid) or French message. |
| `utils/settingsResponse.js` | C | C | Pure helpers: `maskEmail`, `fingerprintPrivateKey`, `computeConfigured`, `computeStatusLabel`, `formatUpdatedAtLabel`, `shapeResponse`. |
| `utils/googleCalendarClient.js` | C | C | `getGoogleCalendarConfig` (reads from `settingsModel`), `getGoogleCalendarClient` (lazy `require('googleapis')`), `testConnection(config, { calendarApi? })` with French error mapping. |
| `database.js` | T | T | Keeps DDL + migrations + bootstrap. **Removes** `db.getAppSettings` / `db.upsertAppSettings`. |

### 4.2 Client side (`client/src/`)

#### Consumed (existing or already-created untracked components)

| Component | Used for |
|---|---|
| `PageActionBar` (new contract — see CLAUDE.md §7) | Sticky top bar with built-in Save + Cancel. |
| `MaskedTextField` | Private key field. |
| `HelpedTextField` | Fields with a help link (Google Calendar fields). |
| `ConfirmDialog` (existing) | Navigation-guard "Quitter sans enregistrer ?" prompt. |

> **Not used here** to keep the design simple: `StatusCard`, `SummaryItem`, `StatusBadge`. The Google Calendar section is plain card with inline status + fields + test button — no "status card" wrapper.

#### Created — new generic components (reusable)

| File | Purpose |
|---|---|
| `components/LogoUpload.js` | Image upload component with preview + Replace + Delete. Props: `{ value, onUpload, onDelete, maxSizeMb=2, accept='image/*', placeholder='Aucun logo', helperText? }`. Used by Settings; will also serve property photos later. |
| `hooks/useDirtyFormGuard.js` | Hook encapsulating: dirty detection (deep-equal draft vs saved), `beforeunload` listener, `popstate` listener, integration with the project's existing `window.__guestflowBeforeNavigate`, and a confirm-dialog state. Returns `{ isDirty, guardDialogOpen, openGuard, dismissGuard, confirmLeave }`. Used by Settings; reusable for any future form-heavy page. |

#### Specific — kept feature-local

| File | Purpose |
|---|---|
| `pages/SettingsPage.js` | Slimmed to ~150 LOC. Loads settings, holds the draft, renders the three section components in stack, wires `PageActionBar` Save/Cancel, integrates `useDirtyFormGuard`. |
| `components/SettingsCompanySection.js` | Card "Informations sur votre activité": `LogoUpload` + 6 identity fields + RIB sub-section (3 fields). Props: `{ values, errors, onChange, onUploadLogo, onDeleteLogo, disabled }`. ~150 LOC. |
| `components/SettingsQuoteSection.js` | Card "Paramètres des devis": 2 fields. ~50 LOC. |
| `components/SettingsGoogleCalendarSection.js` | Card "Synchronisation Google Agenda": status caption (server-provided `statusLabel`) + 2 `HelpedTextField` + 1 `MaskedTextField` + "Tester la synchronisation" button + inline result `Alert`. ~150 LOC. |

### 4.3 API contract

| Method | Endpoint | Body | Response |
|---|---|---|---|
| GET | `/api/settings` | — | `{ company: { name, address, email, phone, siret, tva, iban, bic, bankName, logoPath }, quote: { footerText, validityDays }, googleCalendar: { calendarId, serviceAccountEmail, serviceAccountEmailMasked, privateKeyMasked, privateKeyFingerprint, configured, statusLabel }, updatedAt, updatedAtLabel }` |
| PUT | `/api/settings` | `{ company?: {...}, quote?: {...}, googleCalendar?: {...} }` (per-group; field omitted → preserved; for `googleCalendar.privateKey`: absent → preserve, `""` → clear, non-empty → validate+store) | Same shape as GET on success. `400 { code: 'SETTINGS_INVALID', errors: { fieldName: frenchMessage } }` on validation failure. |
| POST | `/api/settings/logo` | multipart with `logo` file (≤ 2 MB, image MIME) | `{ company: { logoPath } }` |
| DELETE | `/api/settings/logo` | — | `{ company: { logoPath: '' } }` |
| POST | `/api/google-calendar/test-connection` | — | `{ ok: true, message }` or `{ ok: false, code, error }` |

Client + server move in the same session (no compat shim).

## 5. Data model

No schema change. The existing `app_settings` table (singleton, 15+ columns including `companyLogoPath` and `quoteValidityDays` added via in-place migrations) is fine as-is. The MVC refactor only reorganizes access.

## 6. UI / UX

### 6.1 Page structure

```
┌── PageActionBar ────────────────────────────────────────────────┐
│ Paramètres    Modifications non enregistrées       [💾] [✕]    │
└─────────────────────────────────────────────────────────────────┘

┌── Informations sur votre activité ──────────────────────────────┐
│ Logo de votre activité                                          │
│ [preview]  [Choisir un logo / Remplacer]  [Supprimer]           │
│ ↳ Ce logo apparaît sur vos devis et comme favicon. Max 2 Mo.    │
│                                                                 │
│ Raison sociale     [ ___________________________________ ]      │
│ ↳ Nom officiel de votre entreprise.                             │
│                                                                 │
│ Adresse            [ ___________________________________ ]      │
│                    [ ___________________________________ ]      │
│                                                                 │
│ Email professionnel [_____________]  Téléphone [____________]   │
│                                                                 │
│ SIRET              [______________]  TVA intracom [_________]   │
│ ↳ 14 chiffres.                       ↳ FRxx + 11 chiffres.      │
│   Identifiant unique d'entreprise.     Laissez vide si non      │
│                                        assujetti à la TVA.      │
│                                                                 │
│ ─── Vos coordonnées bancaires ──────────────────────────────    │
│                                                                 │
│ Nom de la banque   [______________]  BIC          [_________]   │
│                                       ↳ 8 ou 11 caractères.     │
│ IBAN               [ ___________________________________ ]      │
│ ↳ Ex: FR76 3000 6000 0112 3456 7890 189                         │
└─────────────────────────────────────────────────────────────────┘

┌── Paramètres des devis ─────────────────────────────────────────┐
│ Validité d'un devis (en jours) [30]                             │
│ ↳ Combien de temps un nouveau devis reste valable.              │
│                                                                 │
│ Texte affiché en bas de chaque devis                            │
│ [ _____________________________________________________ ]       │
│ [ _____________________________________________________ ]       │
│ ↳ Laissez vide pour utiliser le message par défaut.             │
└─────────────────────────────────────────────────────────────────┘

┌── Synchronisation Google Agenda ──── 🟢 Synchronisation active ─┐
│ Vos réservations seront automatiquement copiées dans votre      │
│ Google Agenda.                                                  │
│                                                                 │
│ Identifiant de votre Google Agenda                              │
│ [ mon.agenda@gmail.com __________________________ ]             │
│ ↳ Trouvez-le dans Google Agenda > Paramètres > Intégrer le      │
│   calendrier. [Voir l'aide Google ↗]                            │
│                                                                 │
│ Adresse du compte technique Google                              │
│ [ robot@projet.iam.gserviceaccount.com _______ ]                │
│ ↳ Adresse robot créée dans Google Cloud Console.                │
│   [Voir l'aide Google ↗]                                        │
│                                                                 │
│ Clé d'authentification                                          │
│ ┌─────────────────────────────────────────────┐                 │
│ │ •••••••••••••••• [ Modifier ]               │                 │
│ └─────────────────────────────────────────────┘                 │
│ ↳ Collez la valeur du champ `private_key` du fichier JSON       │
│   téléchargé. [Voir l'aide Google ↗]                            │
│                                                                 │
│ [ Tester la synchronisation ]                                   │
│ ┌─────────────────────────────────────────────┐                 │
│ │ ✓ Connexion réussie. Agenda "Nom" accessible.│                 │
│ └─────────────────────────────────────────────┘                 │
└─────────────────────────────────────────────────────────────────┘
```

- The 3 cards stack vertically inside a centered container `maxWidth: { xs: '100%', md: 920 }`.
- All fields are **always editable inline** — no Modifier dialog except for the private key, which uses `MaskedTextField`'s toggle.
- The Google Calendar section header shows the status as a small chip on the right (`success` / `warning` / `error` / `neutral` color). No `StatusCard` wrapper — just a card with a chip next to the title.
- Field-level errors (from `400 SETTINGS_INVALID`) appear in red under the offending field.

### 6.2 Responsive

| Breakpoint | Cards | PageActionBar | Nav-guard dialog |
|---|---|---|---|
| `xs` (≤600px) | Padding `p: 2`. All field pairs (Email/Téléphone, SIRET/TVA, Banque/BIC) stack vertical full-width. Logo preview + buttons stack vertical. "Tester la synchronisation" full-width. | Title hidden, dirty caption visible; Save + Cancel always rendered. | `fullScreen={true}`. |
| `md` (~900px) | Padding `p: 3`. Field pairs side-by-side. | Standard layout. | Standard `maxWidth="sm"`. |
| `lg` (≥1200px) | Container capped at 920px. | Same as md. | Same as md. |

### 6.3 Strings (FR) — humanized vocabulary

#### PageActionBar
- Title: `Paramètres`
- Dirty caption: `Modifications non enregistrées`
- Clean caption: `Dernière mise à jour : DD/MM/YYYY à HH:MM`
- Save tooltip: `Enregistrer`
- Cancel tooltip: `Annuler`

#### Section "Informations sur votre activité"
- Card title: `Informations sur votre activité`
- Subtitle: `Ces informations apparaissent sur vos devis (en-tête et pied de page).`
- Sub-label: `Logo de votre activité`
- Logo placeholder: `Aucun logo`
- Logo buttons: `Choisir un logo` / `Remplacer le logo`; delete tooltip: `Supprimer le logo`
- Logo helper: `Ce logo apparaît sur vos devis et sert de favicon. Max 2 Mo.`
- Field: `Raison sociale` — helper `Nom officiel de votre entreprise.`
- Field: `Adresse` — helper `Vous pouvez utiliser des retours à la ligne.`
- Field: `Email professionnel`
- Field: `Téléphone`
- Field: `SIRET` — helper `14 chiffres. Identifiant unique de votre entreprise.`
- Field: `TVA intracommunautaire` — helper `Format FRxx + 11 chiffres. Laissez vide si vous n'êtes pas assujetti.`
- Divider: `Vos coordonnées bancaires`
- Field: `Nom de la banque`
- Field: `BIC` — helper `8 ou 11 caractères.`
- Field: `IBAN` — helper `Ex : FR76 3000 6000 0112 3456 7890 189`

#### Section "Paramètres des devis"
- Card title: `Paramètres des devis`
- Field: `Validité d'un devis (en jours)` — helper `Combien de temps un nouveau devis reste valable. 30 par défaut.`
- Field: `Texte affiché en bas de chaque devis` — helper `Laissez vide pour utiliser le message par défaut (bienveillant et commercial).`

#### Section "Synchronisation Google Agenda"
- Card title: `Synchronisation Google Agenda`
- Subtitle: `Vos réservations seront automatiquement copiées dans votre Google Agenda.`
- Status labels: `Synchronisation active` / `Configuration en cours` / `Synchronisation non configurée` / `Échec de la dernière synchro`
- Field: `Identifiant de votre Google Agenda` — helper `Trouvez-le dans Google Agenda > Paramètres > Intégrer le calendrier.`
- Field: `Adresse du compte technique Google` — helper `Adresse robot créée dans Google Cloud Console.`
- Field: `Clé d'authentification` — helper `Collez la valeur du champ "private_key" du fichier JSON téléchargé.`
- Help link label (next to each helper): `Voir l'aide Google ↗`
- MaskedTextField controls: `Modifier` / `Annuler la modification`
- Button: `Tester la synchronisation` / `Test en cours…`
- Test alerts:
  - `NOT_CONFIGURED` → `Configurez d'abord les identifiants avant de tester.`
  - `INVALID_CREDENTIALS` → `Email du compte technique invalide ou clé non reconnue.`
  - `FORBIDDEN` → `Le compte technique n'a pas la permission d'accéder à cet agenda. Partagez l'agenda avec lui depuis Google Agenda.`
  - `CALENDAR_NOT_FOUND` → `Agenda introuvable. Vérifiez l'identifiant.`
  - `UNKNOWN` → `Erreur Google : <message>`
  - Success: `Connexion réussie. Agenda « <name> » accessible.`

#### Validation errors (samples)
- Email: `Email invalide.`
- SIRET: `Le SIRET doit contenir 14 chiffres.`
- TVA: `Format TVA invalide (ex : FR12345678901).`
- IBAN: `IBAN invalide.`
- BIC: `BIC invalide (8 ou 11 caractères).`
- PEM: `Clé d'authentification invalide : marqueur de début ou de fin introuvable.`
- Validity: `Doit être un entier entre 1 et 365.`

#### Navigation guard
- Title: `Modifications non enregistrées`
- Body: `Vous avez des modifications non enregistrées. Quitter sans sauvegarder ?`
- Buttons: `Rester` / `Quitter sans enregistrer`

#### Status / load / save
- Save success: `Paramètres enregistrés.`
- Save failure (global, when no field-level errors): `Impossible d'enregistrer les paramètres.`
- Load failure: `Impossible de charger les paramètres.`

## 7. Test plan

### Server unit tests
- [ ] `tests/settings-validation.unit.test.js` — each validator (email, SIRET, TVA, IBAN mod-97, BIC, PEM, quoteValidityDays).
- [ ] `tests/settings-response.unit.test.js` — `maskEmail`, `fingerprintPrivateKey`, `computeConfigured`, `computeStatusLabel`, `formatUpdatedAtLabel`, `shapeResponse` (3 groups wrapping).
- [ ] `tests/settings-model.unit.test.js` — `read()` defaults, `upsert()` trims and refreshes `updatedAt`, `updateLogoPath()` updates only one column. Uses `:memory:` DB with the same DDL.
- [ ] `tests/google-calendar-test-connection.unit.test.js` — `testConnection` returns `NOT_CONFIGURED` when empty; ok on mocked success; maps 401 / 403 / 404 / 500; returns UNKNOWN (no crash) when `googleapis` not installed.

### Manual UI verification — desktop
- [ ] Page loads with the 3 cards; PageActionBar shows clean state, Save/Cancel disabled.
- [ ] Edit any field → Save/Cancel enabled, caption switches to "Modifications non enregistrées".
- [ ] Cancel → form reverts; Save → success, caption switches back to "Dernière mise à jour".
- [ ] Submit invalid SIRET / IBAN / email → red error under field, page stays dirty.
- [ ] Reopen page after save → private key shows masked + Modifier button.
- [ ] Click Modifier → editable field appears with "Annuler la modification".
- [ ] Save without touching key → key preserved.
- [ ] Modifier + leave empty + save → key cleared, status drops to "Synchronisation non configurée".
- [ ] Click "Tester la synchronisation" with valid creds → green Alert (or red with friendly French if Google rejects).
- [ ] Upload logo → preview updates; Delete → placeholder shows.
- [ ] Try to navigate away (sidebar) while dirty → confirm dialog; "Quitter" navigates, "Rester" stays.
- [ ] Reload tab while dirty → browser confirm appears (`beforeunload`).
- [ ] Regression: Réservations → "Sync Google" still works.

### Manual UI verification — mobile (`xs`)
- [ ] 3 cards stack with reduced padding; field pairs stack vertical full-width.
- [ ] PageActionBar compact; Save + Cancel always visible; tooltips appear on long-press.
- [ ] Logo: preview + buttons stack vertical.
- [ ] Tester la synchronisation full-width.
- [ ] Nav-guard dialog opens fullscreen.

### Manual UI verification — tablet (`md`)
- [ ] Field pairs side-by-side; dialog standard `maxWidth="sm"`.

## 8. Out of scope

- **Encryption at rest** of credentials (tracked as `[[settings-encryption]]`).
- **Authentication** on `/api/settings*`.
- **Full MVC refactor of `routes/googleCalendar.js`** (Bloc 6 spec).
- **README correction** about the (non-existent) encryption promise.
- **Removing the env-var fallback** for production.
- **Persisting test results** in DB.
- **PDF devis generation** logic itself.
- **IBAN display formatting** (group-of-4 cosmetic) — possible follow-up.

## 9. Open questions

- Q: Should the Save action send all groups or only dirty ones?
  - **A:** Only dirty fields, grouped per section. Absent groups → preserved.
- Q: Tooltip delay on `PageActionBar`?
  - **A:** 500ms (MUI default is ~100ms; the legacy bar used 1000ms). Compromise between discoverability and not getting in the way.
- Q: SIRET / TVA / IBAN: trim spaces before validation?
  - **A:** Yes — tolerant input, strict storage.
- Q: Reuse `useDirtyFormGuard` requirements — any existing global state we should integrate with beyond `window.__guestflowBeforeNavigate`?
  - **A:** No — same mechanism as today, just packaged in a hook.

---

## 10. Tech debt addressed

- MVC extraction (controllers + model + utils + middleware).
- Server-side validation for all critical fields (email, SIRET, TVA, IBAN, BIC, PEM, quote validity).
- Private key masking + fingerprint (no clear text leaving the server).
- Server computes `configured`, `statusLabel`, `serviceAccountEmailMasked`, `updatedAtLabel` (fat-backend rule).
- Inline sticky bar (596-LOC `SettingsPage.js`) replaced with shared `PageActionBar`.
- Inline dirty + nav-guard logic replaced with `useDirtyFormGuard` hook.
- Inline multer config moved to `middleware/multerLogoUpload.js`.
- Logo upload UI extracted to generic `LogoUpload` component.
- Response shape wrapped under 3 groups (`company`, `quote`, `googleCalendar`) for future extensibility.
- Test connection action + UI button — fixes the "no way to verify Google credentials" pain point.
- `googleapis` lazy-loaded inside `getGoogleCalendarClient` so a missing package doesn't crash boot.

## 11. Deferred (separate future specs)

- TD-D1: encrypt sensitive columns at rest (`[[settings-encryption]]`).
- TD-D2: app-wide authentication.
- TD-D3: README correction.
- TD-D4: full MVC refactor of `routes/googleCalendar.js` (Bloc 6).
- TD-D5: IBAN display formatting (group-of-4).
