# Settings rationalization — fewer settings, one place to find each

| Field | Value |
|---|---|
| **Status** | Approved _(2026-09-21)_ |
| **Branch** | `feature/settings-rationalization` _(one PR, see §10)_ |
| **Created** | 2026-09-21 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Decision page** | [settings-rationalization/avant-apres.html](settings-rationalization/avant-apres.html) — interactive before/after, the page Adrien opens to decide |
| **Supersedes (UI layout only)** | [settings-submenu-reorg.md](settings-submenu-reorg.md) §5, [ds-sweep-settings.md](ds-sweep-settings.md) §3.2 |

---

## 1. Context

GuestFlow's configuration grew one spec at a time, each adding its card where it was convenient at
the time. An audit on 2026-09-21 (code + a local copy of the production database) found:

**Navigation.** The « Paramètres » sidebar group has **10 entries** plus a per-property sub-list, and
an 11th configuration page (« Plan comptable ») lives under « Suivi financier ». Two entries are not
settings at all: « Clients » (the guest directory) and the personal half of « Gestion utilisateur »
(my profile, my password).

**« Générale » is one form of 13 cards and ~45 fields**, rendered as a two-column masonry
(`SettingsPage.jsx`). Identity, devis, VAT, fiscal year, the past-reservation lock, Google Calendar,
Neat, SMTP, notifications, guest-email automation, weather, push and system updates all share one
Save. Finding the SMTP password means scrolling past the IBAN.

**Settings that do nothing.** The six « Délais & relances » fields of `/parametres/paiements`
(`paymentDeposit*`, `paymentBalance*` in `app_settings`) are read only by `settingsModel.paymentTimings()`,
itself read only by the GET/PUT that echo the form (`paymentsController.js:136,151`). Link expiry comes
from Qonto (`paymentRequestService.js:109`), deadlines from the property (`depositDueDays`,
`balanceDaysBefore`, `cancelAfterBalanceDueDays`), reminders from `email_templates`. An operator can
change them and nothing changes.

**Dead columns.** `paymentLastMinuteDays`, `paymentFullPaymentDueDaysBefore` (still declared in
`schema.sql`, so fresh installs create them), `googleServiceAccountEmail`,
`googleServiceAccountPrivateKey` (wiped at boot, `database.js:432`, never read), `neatStoreId` (never
written), and a stray `payment_methods` table left over from the reverted payment-method feature.

**The same address typed four times.** `companyEmail`, `smtpFromEmail`, `smtpUsername` and
`notificationRecipientEmail` hold the same value in the production copy; `smtpFromName` repeats
`companyName`. The server already falls back from one to the other in two places
(`notificationService.js:68`, `emailContextBuilder.js:421`), but the form still asks for each.

**Settings in the wrong place.**
- Per-platform settings are global, yet their editors are spread over three pages: colour, tourist-tax
  mode, « Acompte » and payout days on **each property's** « Plateformes & iCal » table
  (`PropertyDetail.jsx:505-595`), commission % on the per-property pricing page
  (`PlatformPriceCard.jsx`), account number and deductible VAT on « Plan comptable ». Editing
  Airbnb's colour from the Gîte page silently changes it for the Lodge.
- The VAT rates on commissions and cancellation indemnities are edited in « Générale » but only shown
  (read-only, with a link) on « Plan comptable », the accountant's page that consumes them.
- The school-holiday sync frequency (60 days) and horizon (24 months) are editable in a dialog; nobody
  needs to change them.
- The early-arrival / late-departure auto-options are edited on the property page **and** listed again
  in the options catalogue, once per property, as undeletable rows (`OptionsPage.jsx:706`).

**Bugs found along the way.**
1. `backTo="/parametres"` on « Blanchisserie » and « Tarifs facturables » (`LinenStockPage.jsx:100`,
   `BillableAmountsPage.jsx:91`) — the route does not exist, the back arrow lands on « Page introuvable ».
2. The English devis footer is written (`settingsController.js:47`) but never returned
   (`settingsResponse.js:44-47`): the field always loads empty and the saved text is invisible.
3. `App.jsx:711-716` reads `settings.companyLogoPath`; the API returns `company.logoPath`, so that
   favicon code never runs (the server middleware hides the bug).
4. _(Withdrawn 2026-09-21: `balanceDaysBefore` already defaults to 30 in `schema.sql`, the model and
   the UI — the audit misread an old migration.)_
5. « Fermetures » has no back arrow while its sibling tab has one; « Paiements » has Save but no Cancel.
6. The property page points to « Paramètres → Taux de TVA », a section name that does not exist; the
   options page title reads « Options de sejour ».
7. The past-reservation unlock is ON in the production copy — a global escape hatch that was
   forgotten open.

## 2. Goal

Adrien finds any setting in two clicks, from a settings area that groups them by what they are about;
every field he sees has an effect; nothing is asked twice; and a global value is edited in exactly
one place.

## 3. Functional rules

### 3.A Navigation

1. **The « Paramètres » sidebar submenu keeps its current format** (decided 2026-09-21): plain text
   entries with the « · » bullet, no icons, unfolding under « Paramètres » in the sidebar exactly as
   today, with the property sub-list under « Logements ». No second navigation column, no settings
   home page. Clicking « Paramètres » opens « Établissement ». On `xs` the submenu lives in the drawer,
   as today.
2. **Its entries are reordered into families**, separated by a thin divider (no family label). In
   order:

   | Family | Page | Route | Content |
   |---|---|---|---|
   | Mon activité | Établissement | `/settings/etablissement` | Identity, logo, contact, bank details, gate code, **devis** (validity, FR / EN footers) |
   | | Logements (+ one entry per property) | `/properties` | List + property page (§3.D) |
   | | Plateformes | `/settings/plateformes` | **New** — every per-platform commercial setting (§3.C) |
   | Offre & calendrier | Options & ressources | `/parametres/options-ressources` | Tabs Options · Ressources · **Facturables au SAS** |
   | | Recettes tarifaires | `/parametres/recettes` | Unchanged content |
   | | Vacances & fermetures | `/parametres/vacances-fermetures` | Unchanged content, sync settings hard-coded |
   | Opérations | Linge | `/parametres/stock-blanchisserie` | Laundry day + stock |
   | Argent | Paiements en ligne | `/parametres/paiements` | Qonto connection only |
   | | TVA & exercice | `/settings/tva-exercice` | VAT rate + closing month |
   | Communication | Emails & notifications | `/settings/emails` | Sending, automation, email content, operator notifications, push |
   | Connexions | Intégrations | `/settings/integrations` | Google Agenda, Neat, Météo-France status cards |
   | Administration | Utilisateurs | `/account` → `/settings/utilisateurs` | Admin user table |
   | | Système | `/settings/systeme` | Version & updates, public URL |

   13 entries (10 today): more, but each is one short page, where « Générale » used to hold 13 cards.
3. **No settings search** (dropped 2026-09-21 with the second column it lived in).
4. **Each page owns its Save.** The single 13-card save disappears; a page saves only its own fields,
   through the existing `PUT /api/settings` (partial payload, already supported).
5. **« Clients » leaves « Paramètres»** and becomes a top-level sidebar entry.
6. **« Mon compte »** (my information, my password — every role) moves to a user entry at the bottom of
   the sidebar, above « Se déconnecter ». « Utilisateurs » keeps only the admin table.
7. **Roles are unchanged**: every settings page is admin-only; « Plan comptable » stays under « Suivi
   financier » for the accountant; « Mon compte » stays reachable by every role.
8. Old URLs redirect (`/parametres/tarifs` → Options & ressources, tab Facturables; `/account` →
   `/settings/utilisateurs` for an admin, « Mon compte » otherwise).

### 3.B Settings removed, derived or fixed

9. **Removed — no effect today:** the six « Délais & relances » fields and their columns,
   `paymentTimingsValidation.js`, `settingsModel.paymentTimings()` and the timings half of
   `GET|PUT /api/payments/settings`.
10. **Removed — dead columns:** `paymentLastMinuteDays`, `paymentFullPaymentDueDaysBefore`,
    `googleServiceAccountEmail`, `googleServiceAccountPrivateKey`, `neatStoreId`, `smtpPort`; table
    `payment_methods` (`DROP TABLE IF EXISTS`). Removed from `schema.sql` too.
11. **Derived — the SMTP port**: from the security mode at read time (587 STARTTLS / 465 TLS), as the
    save already does (`settingsController.js:157-160`). The legacy « non-standard port » case is dropped.
12. **Derived — one email address.** The « Email de contact » of Établissement is the source.
    - Sending address = contact email unless overridden.
    - SMTP login = sending address unless overridden.
    - Sender name = raison sociale unless overridden.
    - Notification recipient = sending address unless overridden (already the server behaviour).

    Each override is a collapsed « Utiliser une autre adresse / un autre identifiant / un autre nom »
    that reveals the field. The server resolves the effective value in one helper
    (`utils/emailIdentity.js`), used by `emailService`, `notificationService`, `emailContextBuilder`
    and `usersController`.
13. **Fixed in code — school-holiday sync:** every 60 days, 24 months ahead. The dialog and
    `GET|PUT /api/school-holidays/sync-settings` go; « Synchroniser maintenant » stays.
14. **Moved — VAT on commissions (20 %) and on cancellation indemnities (0 %)** to « Plan comptable »,
    next to the account numbers that use them, editable there by admin and accountant. « TVA & exercice »
    keeps the stay VAT rate only.
15. **Hidden — early-arrival / late-departure auto-options** no longer appear in the options catalogue;
    they are edited on the property only.
16. **Moved — public URL** from the SMTP card to « Système » (it is used by emails, OAuth callbacks and
    Qonto webhooks, not only SMTP). Still typed, never guessed from a request host: behind Caddy a LAN
    request would record a LAN address (see `wordpress-deploy-topology` memory).

17a. **Past-reservation unlock becomes per reservation** (decided 2026-09-21, Q1). The global
    `allowEditPastReservations` switch and its column go. A past reservation's page shows, to an admin
    only, a « Déverrouiller cette fiche » action in its lock banner. It unlocks that page only; the
    unlock lives in the page state and is gone as soon as the page is left or reloaded. Writes sent
    while unlocked carry `unlockPast: true`; the server honours it for an admin and ignores it for any
    other role, so the lock stays authoritative server-side (`reservationsController.js:824,957,1124,1426`).

17b. **Removed — the « Envoyer les emails clients sans ma validation » master switch** (decided
    2026-09-21). Each email template already carries its own mode (`email_templates.sendMode`,
    `auto` | `manual`); the switch doubled it. From now on the template's mode alone decides:
    - The migration first sets **every** template to `manual` when `emailAutoSendEnabled = 0` (the
      production state): the six sequence templates are `auto` today and are only held back by the
      switch, so keeping their mode would start mailing guests the next morning. Then the column goes.
    - `utils/autoSendPolicy` answers per template (`sendMode === 'auto'`) and still fails closed on any
      read error. The 08:00 pass is always scheduled and sends only `auto` templates; the confirmation
      fired by an online payment leaves only when `reservation_confirmation` is `auto`.
    - `guestSequenceStartDate` is set the first time a **sequence** template is switched to `auto`
      (instead of the first time the switch was turned on); same guarantee — stays before that date
      never receive the sequence.
    - The « Auto désactivé » chip of the templates list disappears; a template shows « Automatique » or
      « Manuel », nothing else.
17c. **Moved — the J-7 hook** (`properties.emailHook` / `emailHookEn`) leaves the property page. The
    J-7 template dialog (`arrival_reminder_7d`, the template using `{{propertyHook}}`) shows an
    « Accroche par logement » block: one FR and one EN field per property, saved with the template.
    The columns stay on `properties`; only their editor moves.

### 3.C « Plateformes » page (new)

17. One row per platform: colour, commission %, takes a deposit (Oui/Non — kept, Q3), tourist-tax
    collection (3-way), payout after N days. Validation reuses the existing platform validators
    (commission 0–100, payout ≥ 0).
18. The property page's « Plateformes & iCal » table keeps only what is per property: the iCal URL,
    the sync status, add/remove a feed. The global columns become read-only chips with a link to
    « Plateformes ».
19. The commission % field leaves `PlatformPriceCard` (pricing page), which shows it read-only with the
    same link.
20. Accounting columns (account number, deductible VAT) stay on « Plan comptable ».

### 3.D Property page

21. `PropertyDetail` is split into **tabs** (decided 2026-09-21, Q4), one Save for the whole property.
    The tab is kept in the URL (`?tab=`); on `xs` the tabs scroll horizontally.
    - **Général**: name, name article (with a live « Votre séjour dans le Gîte » echo), max guests, max
      babies, double / single beds, check-in / check-out time, cleaning time.
    - **Tarifs**: the recipe (or « Saisons saisies à la main ») with the season table read-only and the
      « Ouvrir la gestion tarifaire » button — no longer at the bottom of the page; the extra-guest
      block (rule 22); the tourist tax (mode + the fields of that mode); a line pointing to Plateformes
      for who collects the tax and to TVA & exercice for the VAT rate.
    - **Paiement & caution**: the « Demander un acompte » switch, % and due days shown only when on;
      balance (or single payment) due days, cancellation delay, default deposit (caution).
    - **Séjour**: parking distance, wifi, coffee maker (« repris dans les mails clients »); early arrival
      and late departure (offered or not, pricing mode, fixed price only in fixed mode, full-night
      threshold). No J-7 hook any more (rule 17c).
    - **Plateformes & iCal**: one block per imported calendar — the platform's global values as read-only
      chips, the iCal URL (empty = manual entry), last sync, Synchroniser / Désactiver / Retirer; « Ajouter
      un calendrier » among the platforms not yet present; the export link with « Copier ». A disabled
      calendar greys its content (chips, URL, sync line, plus a « Désactivé » chip) but **not its live
      buttons**: « Réactiver » (filled) and « Retirer » keep their colour; only « Synchroniser », which
      cannot run, is greyed.
    - **Documents**: a table (type, name, file) with « Retirer » per row, and a single « Ajouter un
      document » button under it. The button reveals Type, Nom and « Parcourir… » (file picker) with
      « Annuler » / « Enregistrer »; Enregistrer refuses a missing name or file. Adding or removing a
      document is saved at once, through its own endpoint — it is not part of the property's Save.

    A tab holding an unsaved change shows an amber dot; a tab holding an invalid field shows a red dot,
    so a refused Save points to the right tab.
22. The extra-guest price fields are hidden (read-only summary) when a tariff recipe is attached — the
    recipe's seasons override them (`pricing.js:686`).
23a. **Validation on the property** (server-side, mirrored as UX hints): at least one bed; beds must
    sleep at least `maxGuests` (2 per double, 1 per single); guests included in the base price between
    1 and `maxGuests`; deposit % strictly between 0 and 100 (100 % means « turn the deposit off »);
    tourist-tax percentages 0–100; an iCal URL is empty or `https://`.

### 3.E Bugs fixed

23. The bugs of §1 (all but the withdrawn n°4) are fixed. Rule 23 has no UI of its own; each fix is listed in §7.

**Edge cases**
- A page with unsaved changes and a click on another settings entry → the existing dirty-form guard.
- An override email emptied → falls back to the derived value, shown as the placeholder.
- A production row whose `smtpUsername` differs from `smtpFromEmail` → the migration keeps it as an
  explicit override; equal values become « derived » (stored `''`).
- A legacy SMTP server on a non-standard port → no longer supported; the production value is 587.

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` + `schema.sql` | | T | Drop the dead columns and `payment_methods`; normalise SMTP overrides (rule 12) |
| `models/` | `settingsModel.js` | T | Remove `paymentTimings()` and dead columns; expose effective email identity |
| `utils/` | `emailIdentity.js` | C | Resolves sending address, login, sender name, recipient from Établissement + overrides |
| `utils/` | `paymentTimingsValidation.js` | D | Deleted |
| `utils/` | `settingsResponse.js` | T | Return `footerTextEn`; return `{ value, derivedFrom }` for the email identity |
| `controllers/` | `paymentsController.js` | T | Remove the timings GET/PUT |
| `controllers/` | `reservationsController.js` | T | Replace the `allowEditPastReservations` read by the per-request `unlockPast` flag, admin only (rule 17a) |
| `utils/` | `autoSendPolicy.js`, `emailAutoSendScheduler.js`, `emailAutoSendRunner.js`, `reservationEmailSender.js`, `guestEmailSequenceRunner.js` | T | Per-template decision, no master switch (rule 17b) |
| `controllers/` | `emailTemplatesController.js`, `emailsController.js`, `settingsController.js` | T | Sequence start date set on the first sequence template switched to `auto`; queue shape no longer depends on a switch (rule 17b) |
| `controllers/` | `settingsController.js` | T | Drop `smtpPort`; accept the override fields; move commission/indemnity VAT out |
| `controllers/` | `platformAccountsController.js` (or model) | T | Accept `vatRateCommission` + `vatRateCancellationCompensation` (admin + accountant) |
| `controllers/` + `models/` | `platformsController.js` / `platformsModel.js` | T | One endpoint listing and updating all per-platform commercial fields |
| `services/` | `emailService.js`, `notificationService.js`, `emailContextBuilder.js`, `usersController.js` | T | Read the identity through `emailIdentity` |
| `scheduledTasks.js` | | T | Constants for the school-holiday sync |
| `routes/` | `schoolHolidays.js` | T | Remove `sync-settings` |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `SettingsPage.jsx` | D | Split into the pages below |
| `pages/` | `settings/EstablishmentSettingsPage.jsx` (incl. devis), `VatFiscalSettingsPage.jsx`, `EmailSettingsPage.jsx`, `IntegrationsSettingsPage.jsx`, `SystemSettingsPage.jsx`, `PlatformsSettingsPage.jsx` | C | One page per group, each with its own `PageActionBar` and save; they compose the existing `Settings*Section` cards |
| `pages/` | `AccountPage.jsx` | C | « Mon compte » split out of `UserManagementPage` |
| `pages/` | `PropertyDetail.jsx` | T | Tabs; global platform columns read-only |
| `pages/` | `PaymentsSettingsPage.jsx` | T | Qonto only; Cancel added |
| `pages/` | `EmailTemplatesPage.jsx` | T | « Accroche par logement » block in the J-7 template dialog (rule 17c); « Auto désactivé » chip removed (rule 17b) |
| `pages/` | `ReservationPage.jsx` | T | « Déverrouiller cette fiche » in the past-stay banner (admin), local unlock state, `unlockPast` on writes |
| `pages/` | `OptionsResourcesPage.jsx` | T | Third tab « Facturables au SAS »; auto-options hidden |
| `pages/` | `LinenStockPage.jsx`, `BillableAmountsPage.jsx`, `EstablishmentClosuresPage.jsx` | T | Back links fixed |
| `pages/` | `PlatformAccountsPage.jsx` | T | VAT fields become editable |
| `components/` | `DerivedValueField.jsx` | C | Shows a derived value with « Utiliser une autre valeur » revealing an override field — generic (email identity today, any « same as X unless » setting tomorrow) |
| `components/` | `SettingsSmtpSection.jsx`, `SettingsVatSection.jsx`, `SettingsCompanySection.jsx`, `SchoolHolidaysSyncSettingsDialog.jsx`, `SettingsReservationLockSection.jsx` | T/D | Fields removed or moved; the dialog and the lock card are deleted |
| `constants/` | `settingsMenu.js` | C | The ordered submenu entries and their family breaks, read by the sidebar |
| routing | `App.jsx`, `constants/roles.js` | T | Settings routes, redirects, reordered submenu with dividers, Clients + Mon compte entries; favicon read fixed |

**Component reuse declaration**

| Category | Components | Notes |
|---|---|---|
| Consumed | `PageActionBar`, `StatusCard`, `StatusBadge`, `SummaryItem`, `MaskedTextField`, `HelpedTextField`, `ConfirmDialog`, `DataPageScaffold` | |
| Created (generic) | `DerivedValueField` | For any setting that defaults to another (« = email de contact » + « Utiliser une autre adresse ») |
| Specific | the seven `settings/*Page.jsx` | Thin compositions of existing cards |

### 4.3 API contract

| Method | Endpoint | Change |
|---|---|---|
| GET/PUT | `/api/settings` | `smtp.port` removed; `smtp.username` / `fromEmail` / `fromName` / `notifications.recipientEmail` return `{ value, override }`; `quote.footerTextEn` returned; `vat.rateCommission` / `rateCancellationCompensation` removed |
| GET/PUT | `/api/payments/settings` | Timings removed (route deleted if nothing remains) |
| GET/PUT | `/api/accounting/platform-accounts` | Gains `vatRateCommission`, `vatRateCancellationCompensation` |
| GET/PUT | `/api/platforms/settings` | **New** (admin): all platforms with colour, commission, deposit, tax collection, payout |
| GET/PUT | `/api/school-holidays/sync-settings` | Removed |
| GET/PUT | `/api/settings` | `reservations.allowEditPastReservations` removed |
| PUT/DELETE | `/api/reservations/:id` (+ the other past-locked writes) | Accept `unlockPast: true`, honoured for an admin only |

## 5. Data model

- `ALTER TABLE app_settings DROP COLUMN …` for the 12 dead columns (six timings, two orphans, two
  service-account, `neatStoreId`, `smtpPort`) plus `allowEditPastReservations` (rule 17a) and `emailAutoSendEnabled` (rule 17b), each guarded by a `PRAGMA table_info` check;
  `DROP TABLE IF EXISTS payment_methods`.
- SMTP overrides: `smtpUsername = ''` where it equals `smtpFromEmail`; `smtpFromName = ''` where it
  equals `companyName` or is `'GuestFlow'`; `smtpFromEmail = ''` where it equals `companyEmail`;
  `notificationRecipientEmail = ''` where it equals the sending address.

- Before dropping `emailAutoSendEnabled`: when it is 0, `UPDATE email_templates SET sendMode = 'manual'`
  (rule 17b). When it is 1 (not the production case), templates keep their mode.

**Data impact:** the dropped columns hold values nothing reads, except `emailAutoSendEnabled`, whose
meaning is carried over into the templates' modes so that no email starts leaving on its own. The SMTP normalisation changes no
effective value — every emptied column resolves to exactly what it held. A `Migration` changelog
entry records both.

## 6. UI / UX

The interactive before/after is the reference:
[settings-rationalization/avant-apres.html](settings-rationalization/avant-apres.html).

- **Desktop (`md+`)**: the sidebar submenu as today (text, « · » bullets, no icons) with thin
  dividers between families; the page on the right, max width 880 px, one column of cards.
- **Mobile (`xs`)**: the same submenu in the drawer; a page opens full width. No masonry anywhere.
- **Action bar**: every page has `<PageActionBar title=… onSave onCancel />`; pages without a form
  (Intégrations, Système, Recettes) have no Save. The title is the page name, never « Générale ».
- Copy: see the decision page for each label.

## 7. Test plan

### Server unit tests (`server/src/tests/settings-rationalization.unit.test.js`)
- [ ] Dead columns absent after migration on a DB that has them; migration idempotent (rules 9-10)
- [ ] `emailIdentity`: each derived value and each override (rule 12)
- [ ] SMTP normalisation keeps every effective value (§5)
- [ ] Port derived from the security mode (rule 11)
- [ ] `GET /api/settings` returns `footerTextEn` (bug 2)
- [ ] Platform settings endpoint validates commission and payout (rule 17)
- [ ] Accountant can PUT the two VAT rates on plan comptable (rule 14)
- [ ] `unlockPast` lets an admin edit a past reservation, is ignored for reception, and nothing is unlocked without it (rule 17a)
- [ ] Migration with the switch OFF sets every template to `manual`; nothing is sent by the 08:00 pass afterwards; an `auto` template is sent; a read error sends nothing (rule 17b)
- [ ] Sequence start date set on the first sequence template switched to `auto`, never moved afterwards (rule 17b)

### Client (Vitest) + E2E
- [ ] Property tabs: dirty / invalid dots, deposit fields shown only when on, recipe hides extra-guest fields
- [ ] Each settings page saves only its own fields
- [ ] Playwright: every old URL redirects; back arrows of Linge and Tarifs land on a real page

### Manual UI verification
- [ ] Desktop / tablet / mobile of the settings area and of the property tabs
- [ ] Send an SMTP test with no override; with a login override
- [ ] Change Airbnb's colour on « Plateformes », see it on both properties

## 8. Out of scope

- Retiring `portalCode` (waits for guest-gate-access, which keeps it as the physical fallback).
- Per-property option prices moving to the property page (kept in the option dialog for now).
- Any change to what a setting computes — this is layout, deletion of dead fields, and derivation of
  duplicated ones.
- A dark theme.

## 9. Open questions

All resolved by Adrien on 2026-09-21:
- Q1: Past-reservation unlock → **per-reservation « Déverrouiller cette fiche »**, relocking when the
  page is left; the global switch and its column go (rule 17a).
- Q2: VAT on commissions / indemnities → **moved to Plan comptable** (rule 14).
- Q3: « Acompte » per platform → **kept, on the Plateformes page** (rule 17).
- Q4: Property page → **tabs** (rule 21).

## 10. Delivery — one PR (decided 2026-09-21)

Everything ships in a single PR, in ordered commits so the review follows the thread:
1. Server clean-up + bugs — rules 9-11, 13, 23.
2. Derived identity and moved settings — rules 12, 14, 16, 17a, 17b, 17c.
3. Settings submenu and pages, Clients + Mon compte, Plateformes — rules 1-8, 17-20.
4. Property tabs — rules 15, 21-23a.
