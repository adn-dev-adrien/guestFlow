# Plugins — phase P: productisation (a new customer starts from zero)

| Field | Value |
|---|---|
| **Status** | Implemented (2026-10-07) — rule 30's repository move pending the private repository |
| **Branch** | `feature/plugins-phase-p-productisation` (from `inte/plugins` at 252edfbb) |
| **Created** | 2026-10-06 |
| **Author** | Adrien |
| **Related PR** | — (target `inte/plugins`) |
| **Parent study** | [`specs/plugins-inventory.md`](plugins-inventory.md) — §7 « Specific to Solio, but not a plugin », §12 phase P, §13 Q2 |
| **Previous phase** | [`specs/plugins-phase-3c-hourly-resources.md`](plugins-phase-3c-hourly-resources.md) (PR #661) |
| **Feature specs** | [`specs/guest-email-sequence.md`](guest-email-sequence.md), [`specs/accountant-accounting-export.md`](accountant-accounting-export.md), [`specs/control-plane-plans-and-access.md`](control-plane-plans-and-access.md) — their rules hold, except where §3 below corrects them |
| **Summary for review** | [`docs/specs/2026-10-06-plugins-phase-p-productisation.html`](../docs/specs/2026-10-06-plugins-phase-p-productisation.html) |

---

## 1. Context

Phases 0–3 moved the optional features into plugins. What is left in the core still speaks for one
customer, Domaine Solio. An audit of the tree on 2026-10-06, after phase 3c, found the following.

**A brand-new database gets Solio content:**
- the 6 emails of the guest sequence, seeded `enabled` with Solio copy: the address of the domain,
  « 13 hectares », the nordic bath, the shared pool, `map.domainesolio.com`;
- 14 catering options with Solio's price list (Brasserie du Pilat, Pressoir du Pilat, Terroir
  Ardèche), re-seeded at every boot;
- a pool season (15 June – 31 August) that every install is assumed to have;
- two extinguisher repair rows, and an extinguisher check that every departure SAS asks for;
- a « Lit bébé » supplement at Solio's price (5 €).

**The code writes Solio sentences at render time.** `utils/stayContentContext.js` composes about 25
paragraphs of the sequence emails in French and English. Among them:
- the packing list « pour le bain nordique » and « les sentiers du domaine »;
- the Pilat producers;
- the trappers' dinner and the animals;
- the Nespresso machine;
- breakfast « au bâtiment d'accueil ».

`emailContextBuilder.js` also adds a nordic-bath reminder to any resource whose name contains
« nordique ». The unsubscribe page is titled « Vos nouvelles du Domaine Solio ».

**Other leftovers:**
- Lodgify is hard-coded as a direct channel (`DIRECT_CHANNELS`);
- the VAPID subject falls back to `contact@domainesolio.com`;
- the account plan is a constants file: an accountant cannot change a number without a release;
- the public repository carries Solio's WordPress site: 43 files, with LAN addresses and an SSH user;
- the README carries Solio's DNS records, and there is a configuration script for Aventura Lodge.

**There is no first run.** A hosted instance gets its first admin from the console
(`create-first-admin.js`). That admin then lands on an empty dashboard: no company, no property, no
plugin active. Nothing says where to start.

Decisions taken on 2026-10-06:

- **One spec for the whole of phase P** (answer to the split question).
- **Solio keeps its texts through a migration on existing databases** (P18). This revisits
  inventory §13 Q2, where an external content pack had been decided on 2026-09-28. A database that
  already holds properties or reservations receives today's texts as data, automatically: the same
  principle as the built-in plugins activated on existing databases (phase 0). There is no manual
  step at Solio's upgrade. The Solio copy stays in the repository, frozen inside that one migration.
- **The email phrases tied to options and properties live on those options and properties** (P19).
  Prices follow the options; the engine assembles the sentences without knowing Solio.

## 2. Goal

- **A new instance starts neutral.** No Solio name, place, product or price reaches it, and an
  assistant walks the first admin from the company to the first property and the plugins.
- **Solio sees no difference.** Every guest email, in French and English, renders byte for byte as
  before the upgrade. A golden test proves it.
- **The texts the code wrote become data** the operator edits in Réglages, with neutral defaults.
- **The account plan becomes settings** of the accounting plugin.
- **Solio's private material leaves the product repository.**

## 3. Functional rules

### 3.A Stay texts — the sentences of the sequence emails become data

1. **Every sentence that `stayContentContext.js` composes is a stay text.** A stay text has a
   stable key, a French text and an English text. The code still decides *whether* a text appears
   and fills its tokens. It no longer holds any wording, except the neutral default of each key
   (`utils/stayTextCatalogue.js`).
2. **The keys** are the following. Tokens are written `{{token}}`; a text may also use the flags
   listed, as `{{#if flag}}…{{else}}…{{/if}}` at one level, which is the email renderer's grammar.

   | Key | Email | Appears when | Tokens and flags |
   |---|---|---|---|
   | `beds.made` | J-7 | beds made (included or booked) | `bedConfig` |
   | `beds.linenNotIncluded` | J-7 | beds not made | `bedConfig`, `price`, flag `linenOffered` |
   | `baby.booked` | J-7 | baby cot booked | — |
   | `baby.offer` | J-7 | babies, cot proposable | `price` |
   | `bag.items` | J-7 | always (empty = no line) | flag `stayOverlapsPool` |
   | `bag.towels` / `bag.towelsOffer` | J-7 | towels not covered | `price` (offer only) |
   | `travelLight` | J-7 | parking distance > 0 | `distance`, `propertyFrom`, `propertyName` |
   | `noWifi` | J-7 | property without wifi | `PropertyWith`, `propertyName` |
   | `offers.localIntro` | J-7 | a « local » mention is proposable | `list` |
   | `offers.extrasIntro` / `offers.extrasAfterLocal` | J-7 | an « extras » mention is proposable | `list` |
   | `offers.deadline` | J-7 | a mention is proposable | `date` |
   | `parkingLine` | J-2 | parking distance > 0 | `distance`, `propertyFrom`, `propertyName` |
   | `house` | J-2 | always (empty = no paragraph) | — |
   | `cleaning.included` / `cleaning.booked` / `cleaning.notBooked` | J-2 | per cleaning state | — |
   | `complement.atArrival` / `complement.atDeparture` | J-2 | a balance is due on site | `amount` |
   | `review.direct` | J+1 | direct channel and a Google link | `link` |
   | `review.platform` | J+1 | platform channel | `platform`, `link`, flag `hasGoogleReview` |
   | `instagram` | J+1 | an Instagram link | `link` |
   | `quietSinceDeparture` | J+1 | always | `PropertyWith`, `propertyWith`, `propertyName` |
   | `gift.list` | November | a property has a price | `list` (the `gift.offer` items) |
   | `gift.offer` / `gift.fallback` | November | per property with a price / none | `propertyWith`, `propertyName`, `price` |
   | `booked.babyBed` / `booked.towels` | J-2 | the option was booked | — |

   Every price-bearing text also gets the flag `hasPrice` (the amount is above zero), so a neutral
   default never shows « (0 €) ». Any token may also be read as a flag (`{{#if slots}}`).

3. **A property may override `house`, `travelLight`, `parkingLine` and `noWifi`.** An empty override
   falls back to the global text.
4. **An unknown token or flag is refused at save** (422, message « Variable inconnue : {{x}} »),
   never rendered as literal braces. An empty text is allowed and means « no paragraph ».
5. **« Rétablir le texte par défaut »** puts the catalogue's neutral text back for one key and one
   language.
6. **The stored templates of the sequence keep their variables.** For example,
   `{{bedsParagraph}}`, `{{bagList}}`, `{{coffeeParagraph}}` and `{{quietSinceDeparture}}` keep
   their names and flags; only their source changes. A template an operator already edited keeps
   working unchanged. The neutral templates of rule 13 use four new flags, offered to any template:
   `hasBagList`, `hasCoffeeParagraph`, `hasCleaningParagraph` and `hasQuietSinceDeparture`.

### 3.B Option mentions — what the J-7 proposes and the J-2 confirms

7. **A mention is a sentence about one or more options.** It has:
   - a section: « Produits locaux », « À prévoir » or « Enfants »;
   - a proposal text, French and English, with `{{price}}`;
   - a confirmation text, French and English, used once one of its options is booked;
   - the price to quote: either the lowest price among its available options, or the price of one
     chosen option — falling back to the lowest when that option is not available for the property;
   - its options;
   - an order.

   *Mention* refines the answer « phrases on each option »: Solio quotes its 4 juices in one line, at
   the price of the litre, and a per-option phrase could not say that.
8. **A mention is proposed** under three conditions:
   - one of its options is visible and available for the property;
   - none of them is offered by default (included);
   - none is already booked on the stay.

   This is the rule 20 of `guest-email-sequence.md`, unchanged. A « Produits locaux » mention lands in
   `offers.localIntro`, and an « À prévoir » mention in `offers.extrasIntro`. An « Enfants » mention
   is a paragraph of its own and replaces `kidsParagraph`: it is shown when the stay has children
   and one of its options is available, booked or not, as today.
9. **The confirmations have an order of their own** (« Ordre des confirmations », Options citées
   tab). It is independent of the proposal order, because Solio's J-7 proposes the juices first while
   its J-2 confirms breakfast first. The baby cot (`booked.babyBed`) and the towels (`booked.towels`)
   take a place in it like the mentions. `bookedOptionsParagraph` follows it. The migration writes
   today's order: breakfast, baby cot, towels, board, juice, beer, trappers' dinner, animals.
10. **The engine knows no option by name or seed key any more.** `BEER_SEED_KEYS`, the
    `drink_jus_*` / `board_*` prefixes and the « trappeur » / « animation » matches are deleted from
    the core. They exist only in the migration of §3.E, which reads them once.
11. **A resource carries a sentence for once it is booked** (French and English, token `{{slots}}`:
    the slots placed when hourly resources are a live plugin, else empty). It replaces the
    nordic-bath reminder matched on the name. `hasNordicBath` / `nordicBathReminder` stay as
    variables, now true and filled for any booked resource with a sentence, so stored templates
    keep rendering.

### 3.C Neutral seeds for a new database

12. **The catering seed leaves the core.** `cateringSeed.js` is deleted and no boot inserts or
    re-inserts its 14 rows. Existing rows are data and stay.
13. **The guest sequence is seeded with neutral copy** (`guestEmailSequenceTemplates.js` rewritten).
    It contains no place, no product and no facility the product cannot know of. The seed still
    only inserts a missing `stableKey`, so a stored template is never overwritten.
14. **No pool by default.** `poolSeasonStart` / `poolSeasonEnd` default to empty; empty means no
    pool and `stayOverlapsPool` is false. The `06-15` / `08-31` fallback in the code is removed.
15. **The baby-bed supplement is seeded at 0 €.** The other core options (linen, breakfast, cleaning
    tagging, insurance) are product features and stay seeded. Breakfast is seeded with a neutral
    « À prévoir » mention.
16. **The extinguisher check belongs to the SAS plugin and is off by default.**
    - The plugin gains the setting « Contrôle de l'extincteur ». It governs the departure step (the
      only one the dialog has) and the seal fields the server accepts.
    - Its two repair rows are inserted by the plugin when the setting is turned on, never by the core.
    - With the setting off, the SAS shows no extinguisher step and the audit records none.
17. **The unsubscribe page speaks for the company.**
    - The title is « Vos nouvelles de {companyName} » (English « News from {companyName} »), and
      « GuestFlow » when the name is empty.
    - The copy describes the seasonal emails without naming gift vouchers or greetings.
    - The colours come from the product's neutral palette.
18. **The VAPID subject is resolved** in this order: `VAPID_SUBJECT` → the setting `vapidSubject` →
    `mailto:<companyEmail>` → `mailto:<smtpFromEmail>`. If none is set, push stays off and Réglages
    says so in the existing push card. There is no domainesolio fallback.
19. **A platform counts as direct by an attribute, not by its name.**
    - `platforms.countsAsDirect` is always true for `direct`, and editable for the others under
      Paramètres › Plateformes (« Compté comme vente directe »), a core page: the accounting
      plugin's page could not hold it, since a core rule depends on it.
    - `isDirectChannel(name)` keeps its signature and reads a cached set, refreshed on every platform
      save.
    - The « moteur Lodgify » label becomes the platform's name.

### 3.D The start assistant

20. **An admin is sent to the assistant** when `app_settings.onboardingCompletedAt` is empty. This
    happens after the forced password change. Other roles never see it.
21. **Four steps.** Each step saves when « Suivant » is pressed; the server validates every step,
    and an error keeps the step open.
    1. **Entreprise**:
       - name (required);
       - email (required, valid);
       - phone;
       - address;
       - SIRET (14 digits when filled).
    2. **Premier logement**:
       - name (required);
       - double beds and single beds;
       - capacity (1–50), pre-filled with the sleeping places (two per double bed, one per single
         bed); the existing property rule holds: the sleeping places must cover the capacity
         (decided 2026-10-07);
       - check-in and check-out times;
       - base price per night (≥ 0).

       This creates the property, its standard pricing rule at that price and its arrival/departure
       options, through the existing property creation.
    3. **Plugins**:
       - every plugin the licence allows, with its one-line description;
       - a hosted instance shows the others greyed, with the plan that includes them;
       - « Réservation depuis le site » (`website-booking`) and « Arrivée et départ guidés » (`sas`)
         are ticked by default; labels and descriptions are the catalogue's (`constants/plugins.js`);
       - the ticked ones are installed and activated through the existing plugin endpoints;
       - a failure names the plugin and lets the others go through.
    4. **C'est prêt**: three links (Réglages › Emails, Tarifs, Plugins), and « Ouvrir le tableau de
       bord », which records `onboardingCompletedAt`.
22. **« Plus tard »**, on every step, records `onboardingCompletedAt` and leaves; what was saved stays
    (P21). The assistant can be reopened from Réglages › Système (« Assistant de démarrage »).
23. **Mobile:** the assistant is a full-screen page with one step at a time. The step counter sits
    on top, and « Suivant » is full width.

### 3.E Existing databases — Solio sees no difference

24. **A one-shot migration `productisation_v1`** runs on boot, and only on a database that already
    holds properties or reservations, before the sequence emails are rendered. Data written:
    - `onboardingCompletedAt`, set to now;
    - every stay text whose rendering today differs from the neutral default, written with today's
      wording, globally;
    - `house` per property: the Nespresso sentence, plus the « cafetière familiale » variant for
      properties where `hasFilterCoffeeMaker = 1`;
    - one mention per role found among today's options:
      - juice, at the price of `drink_jus_pomme_1l`;
      - beer, at the lowest price;
      - board, « à partir de » the lowest price;
      - trappers' dinner;
      - breakfast;
      - animation, in the « Enfants » section.

      Each mention gets today's proposal and confirmation sentences, in today's order;
    - the nordic-bath sentence on every resource whose name contains « nordique »;
    - `countsAsDirect = 1` on a `lodgify` platform row;
    - `vapidSubject = 'mailto:contact@domainesolio.com'`, unless the environment sets `VAPID_SUBJECT`;
    - the SAS extinguisher setting turned on when the SAS plugin is active.

    The pool season and the stored templates are already data and are left alone.
25. **The migration is idempotent and conservative.** It records itself and never runs twice. It
    writes a text or a mention only where none exists, and never overwrites an operator's value.
26. **Golden test.** The 6 sequence emails, in both languages, are rendered for a Solio-shaped
    fixture across 6 stays: children or not, pool season or not, every option state, direct and
    platform, wifi or not, parking or not. They are rendered once on the current code; the outputs
    are committed as fixtures before the refactor. After the refactor, on the same fixture, the
    migration runs and the outputs must be identical.

### 3.F Account plan as data (accounting plugin)

27. **The account numbers become plugin settings**, with today's values as defaults:
    - the 3 revenue accounts;
    - the 2 output VAT accounts;
    - tourist tax;
    - deductible VAT on commissions;
    - discount;
    - cancellation compensation and tips;
    - the journal code (`VT`).

    `accountPlan.js` keeps the mapping logic and reads the numbers from the settings. The
    per-platform commission accounts already live on `/comptabilite/plateformes` and stay there.
28. **Validation:** an account is 3 to 12 digits, except the client auxiliary prefix, which stays as
    it is; a journal code is 1 to 4 uppercase letters or digits. Two different roles may share an
    account; tips and compensation already do.
29. **The exported CSV is unchanged** for the default values. The layout is named « Format standard
    (CSV) » in the code and the UI, instead of « SOLIO ». Another format, FEC for instance, is out of
    scope.

### 3.G Repository

30. **Solio's private material leaves the product repository** (P20):
    - `integrations/wordpress/solio-site/` moves to a private repository `adn-dev-adrien/solio-site`,
      created by Adrien;
    - `scripts/configure-aventura-lodge-2026.mjs` moves with it;
    - the Solio section of `integrations/wordpress/INSTALL.md` moves with it;
    - the 6 server tests that read `solio-site/mu-plugins` (cited by `site-english-version.md`)
      move with it;
    - the README's DNS section is rewritten for `example.com`.

    The history keeps the old files: the purge is the separate `refs/pull` item of the inventory.

    *2026-10-07:* the private repository does not exist yet, so the move ships in a follow-up PR once
    Adrien has created it; the README and the WordPress plugin are done here.

    > **Sans test** — moving files to another repository is checked by reading the tree, not by a test.
31. **The WordPress plugin** names « GuestFlow » as its author, and its settings placeholder is
    `https://guestflow.example.com`.

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `utils/` | `stayTextCatalogue.js` | C | The keys of rule 2, their tokens and flags, and their neutral defaults in French and English |
| `utils/` | `stayContentContext.js` | T | Chooses the texts and fills the tokens; no wording. Classification by mention instead of role |
| `utils/` | `emailTemplateRenderer.js` | T | Exposes `validateTokens(text, allowed)` for rule 4 |
| `utils/` | `emailContextBuilder.js` | T | Resource sentences instead of the « nordique » match (rule 11) |
| `utils/` | `guestEmailSequenceTemplates.js` | T | Neutral copy (rule 13) |
| `utils/` | `cateringSeed.js` | D | Rule 12 |
| `utils/` | `babyBedSupplementSeed.js` | T | 0 € (rule 15) |
| `utils/` | `platformNameFormat.js` | T | `isDirectChannel` reads the cached `countsAsDirect` set (rule 19) |
| `utils/` | `vapid.js` | T | Rule 18 |
| `utils/` | `productisationMigration.js` | C | Rule 24: the only place that knows Solio's wording, seed keys and option names |
| `models/` | `stayTextsModel.js` | C | `stay_texts`, global and per property |
| `models/` | `emailMentionsModel.js` | C | `email_mentions` + `email_mention_options` |
| `models/` | `stayFactsModel.js` | T | Loads texts, mentions and resource sentences for the context |
| `models/` | `onboardingModel.js` | C | `onboardingCompletedAt`: open or completed |
| `models/` | `resourcesModel.js`, `platformsModel.js`, `settingsModel.js`, `propertiesModel.js` | T | The resource sentence; `countsAsDirect`; `vapidSubject` and `onboardingCompletedAt`; the standard rule at the assistant's price |
| `controllers/` | `resourcesController.js`, `platformsController.js`, `settingsController.js`, `authController.js` | T | `{{slots}}` validation; `countsAsDirect` and the refresh; the VAPID subject after a company save; `onboardingOpen` on `/me` |
| `controllers/` | `pluginsController.js` + `plugins/sdk/createContext.js` | T | A declared setting may carry `afterSave(value)` (rule 16) |
| `scripts/` | `seed-e2e.js` | T | Closes the assistant on the E2E database |
| `controllers/` | `stayTextsController.js` | C | List, save with token validation, reset to default |
| `controllers/` | `emailMentionsController.js` | C | CRUD, both orders, preview |
| `controllers/` | `onboardingController.js` | C | State, the 4 steps, « Plus tard » |
| `controllers/public/` | `emailPreferencesController.js` | T | Company name, neutral copy (rule 17) |
| `routes/` | `stayTexts.js`, `emailMentions.js`, `onboarding.js` | C | Thin |
| `database.js`, `schema.sql` | — | T | New tables and columns; empty pool defaults; the migration call; catering seed and extinguisher rows removed |
| `plugins/sas/` | `index.js`, `settings.js` (C), `controller.js`, `billablesController.js` | T | Extinguisher setting, its repair rows, the seal fields refused while off (rule 16) |
| `plugins/accounting-export/` | `accountPlan.js`, `settings.js`, `accountingExport.js`, `accountingModel.js`, `platformAccountsModel.js`, `controller.js` | T | Rules 27–29: `planMapper` turns the engine's default numbers into the plan's when the rows are produced |
| `middleware/` | `enforceRoleAccess.js` | T | The new routes are admin-only |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `pages/` | `OnboardingPage.jsx` | C | The 4 steps; full screen on `xs` |
| `pages/settings/` | `EmailTextsSettingsPage.jsx` | C | Réglages › Emails › « Textes des mails »: stay texts by email, mentions, live preview |
| `components/` | `TokenTextField.jsx` | C | **Generic**: a FR/EN text field with its token chips, insertion at the cursor, the server's refusal shown inline. The email template editor can adopt it later |
| `components/` | `MentionEditor.jsx` | C | Specific: one mention, its options and its price source |
| `components/` | `StepperPage.jsx` | C | **Generic**: a page-level stepper with the counter, « Plus tard », « Précédent » / « Suivant ». Reusable for any guided flow |
| `components/property/` | `PropertyStayTexts.jsx` | C | Specific: « Textes propres à ce logement », saved text by text |
| `pages/settings/` | `SystemSettingsPage.jsx` | T | « Assistant de démarrage » reopens `/demarrage` |
| `components/` | `SettingsPushNotificationsSection.jsx` | T | Says when no address can sign push (rule 18) |
| `plugins/sas/` | `ExtinguisherCheckCard.jsx` | C | The switch, in the « Facturables au SAS » tab |
| `plugins/accounting-export/` | `PlatformAccountsPage.jsx` | T | The « Comptes » section |
| `components/` | `SettingsEmailContentSection.jsx` | T | Pool season may be empty; a link to « Textes des mails » |
| `components/property/` | `PropertyStayTab.jsx` | T | « Cafetière familiale » replaced by `PropertyStayTexts` (rule 3) |
| `components/` | `PlatformPriceCard.jsx` | T | Rule 19 label |
| `pages/` | Resource form (`ResourcesPage`) | T | « Phrase dans les mails une fois réservée » (rule 11) |
| `pages/settings/` | `PlatformsSettingsPage.jsx` | T | « Compté comme vente directe » |
| `plugins/accounting-export/` | settings section | T | « Plan comptable » (rules 27–28) |
| `plugins/sas/` | settings + `ReservationSasDialog.jsx` | T | Rule 16 |
| `App.jsx` | — | T | Redirects an admin to `/demarrage` while onboarding is open (rule 20) |

Reused: `PageActionBar`, `FormDialog`, `ConfirmDialog`, `HelpedTextField`, `StatusBadge`, `ErrorAlert`,
`LoadingState`.

### 4.3 API contract

| Method | Path | Body / answer |
|---|---|---|
| GET | `/api/stay-texts?propertyId=` | `[{ key, email, tokens, flags, fr, en, defaultFr, defaultEn, isDefault, overridable }]` |
| PUT | `/api/stay-texts/:key` | `{ fr, en, propertyId? }` → 200 or 422 `{ field, message }` |
| DELETE | `/api/stay-texts/:key?propertyId=&lang=` | back to default, or to the global text for a property |
| GET / POST / PUT / DELETE | `/api/email-mentions[/:id]` | `{ section, offerFr, offerEn, bookedFr, bookedEn, priceSource, priceOptionId, optionIds }`; GET answers `{ mentions, confirmationOrder }` |
| PUT | `/api/email-mentions/order` | `{ ids }`, every mention: the proposal order |
| PUT | `/api/email-mentions/confirmation-order` | `{ items }` of `mention:<id>`, `babyBed`, `towels` (rule 9) |
| POST | `/api/email-mentions/preview` | `{ propertyId, children, startDate }` → `{ fr, en }`: the J-7 offers paragraph and the J-2 confirmations, rendered by the server |
| GET | `/api/onboarding` | `{ open, company, plugins: [{ id, label, description, allowed, plan, state, recommended }] }` |
| PUT | `/api/onboarding/company`, `/api/onboarding/property` | Validated writes; 422 `{ errors }` per field; 402 when the plan's unit quota is reached |
| PUT | `/api/onboarding/plugins` | `{ ids }` → `{ results: [{ id, ok, error }] }`, each through the existing install or activate handler |
| GET | `/api/auth/me` | gains `onboardingOpen` (admins only) |
| GET / PUT | `/api/platforms/settings` | each row gains `countsAsDirect` |
| GET / PUT | `/api/accounting/platform-accounts` | gains `plan: [{ key, value, default }]`; PUT takes `plan: { key: value }` |
| POST | `/api/onboarding/done` | Records `onboardingCompletedAt` |

## 5. Data model

- **`stay_texts`** `(key TEXT, propertyId INTEGER NOT NULL DEFAULT 0, fr TEXT, en TEXT, updatedAt)`,
  primary key `(key, propertyId)`; `propertyId` 0 is the global text. No row means the catalogue
  default; a NULL language means « never edited » for that language, '' means « no paragraph ».
  Created with the sequence schema (`utils/guestEmailSequenceSchema.js`), so test databases get it.
- **`email_mentions`** `(id, section TEXT CHECK IN ('local','extras','kids'), offerFr, offerEn,
  bookedFr, bookedEn, priceSource TEXT CHECK IN ('min','option'), priceOptionId NULL, sortOrder)`.
- **`email_mention_options`** `(mentionId, optionId)`, primary key on both, with cascade.
- **`app_settings.bookedConfirmationOrder`**: a JSON array of `mention:<id>`, `babyBed` and `towels`
  (rule 9). A mention missing from it goes last, in mention order.
- **New columns:**
  - `resources.emailBookedText`, `resources.emailBookedTextEn`;
  - `platforms.countsAsDirect INTEGER DEFAULT 0`;
  - `app_settings.onboardingCompletedAt`, `app_settings.vapidSubject`;
  - the `productisation_v1` marker is a row in `migrations`, like every one-shot migration.
- **Changed defaults:**
  - `app_settings.poolSeasonStart` / `poolSeasonEnd`: the schema default becomes empty for new
    rows. The existing row keeps its value.
  - `properties.hasFilterCoffeeMaker` is no longer read. The column stays, because SQLite cannot drop
    it safely on old versions.
- **No data is lost.** Catering rows, stored templates, repair rows and the pool season stay. The
  migration only adds rows.

## 6. UI / UX

- **Réglages › Emails & notifications** gains « Textes des mails », with three tabs:
  - **Par mail**: the stay texts grouped by email, French and English side by side on `md+` and
    stacked on `xs`, with token chips and « Rétablir »;
  - **Options citées**: the mentions by section, reorderable, each with its options, its price
    source and its two texts, then the confirmation order (rule 9);
  - **Aperçu**: a sample stay (property, children, date) and the paragraphs as the guest will read
    them.

  Every text is impersonal on the admin side; the guest copy keeps the « vous » of the emails.
- **Logement › Séjour:** « Textes propres à ce logement » holds the overridable keys, each empty by
  default with the global text shown as placeholder.
- **Ressource:** « Phrase dans les mails une fois réservée » (FR/EN, `{{slots}}` chip).
- **Assistant:** `/demarrage`, outside the side menu, with the GuestFlow wordmark, one step per
  screen and the counter « Étape 2 sur 4 ».
- **SAS plugin settings:** a switch « Contrôle de l'extincteur ».
- **Paramètres › Plateformes:** a switch « Compté comme vente directe » per platform; it is
  locked on for `direct`.
- **Comptabilité › Plan comptable** (plugin settings): one field per account, with its role as the
  label and the default as the helper text.

## 7. Test plan

### Server unit tests

| File | Tests | Rules |
|---|---|---|
| `productisation-golden.unit.test.js` | 1 (72 renderings) | 26 — 6 emails × 2 languages × 6 stays, byte-identical; captured before the refactor, with the option-metadata fix of #671 |
| `stay-texts.unit.test.js` | 7 | 1–6 |
| `email-mentions.unit.test.js` | 8 | 7–11 |
| `neutral-seeds.unit.test.js` | 5 | 12–17, on a new database booted by `database.js` |
| `vapid-subject.unit.test.js` | 2 | 18 |
| `platform-counts-as-direct.unit.test.js` | 4 | 19 |
| `onboarding.unit.test.js` | 5 | 20–22 |
| `productisation-migration.unit.test.js` | 6 | 24–25 |
| `plugins/accounting-export/tests/account-plan-settings.unit.test.js` | 5 | 27–29 |
| `plugins/sas/tests/sas-extinguisher-setting.unit.test.js` | 3 | 16 |
| `wordpress-plugin-neutral.unit.test.js` | 2 | 31 |

Suites that checked Solio's wording read it from `tests/solioWordingFixture.js`, built from the same
constants as the migration; the tests that assume Lodgify is a direct channel set it as the migration
does.

### Client (Vitest)

`TokenTextField` (2), `MentionEditor` (2), `EmailTextsSettingsPage` (3), `OnboardingPage` (4),
`PropertyStayTexts` (1), `ReservationSasDialog.extinguisher-off` (1),
`PlatformsSettingsPage.counts-as-direct` (1), `PlatformAccountsPage.account-plan` (2).

### E2E

`e2e/specs/onboarding/onboarding.spec.js` (2): the four steps with a refused step, ending on the
dashboard with the property at its price; the mobile layout and « Plus tard ». The E2E database is
shared by every spec, so the spec reopens the assistant instead of starting from an empty database;
the forced password change is covered by the auth specs. `seed-e2e.js` closes the assistant for the
rest of the suite, and `option-categories.spec.js` seeds the catering catalogue it needs.

### Manual UI verification

- A copy of the production database: the six emails previewed for a real reservation of each
  property, identical to their preview before the upgrade.
- An empty database: the assistant end to end at 375 px and 1280 px, and a J-7 preview with neutral
  texts.
- « Textes des mails »: an unknown token is refused, and an override shows up in the preview.

## 8. Out of scope

- **The platform list and colours, read from the `platforms` table** (inventory §7). The built-in
  list is the French market's and contains nothing of Solio.
- **One source for `Europe/Paris`**: the French market only was decided on 2026-09-28.
- **Another accounting export format** (FEC).
- **Comments in the code that mention Solio or Adrien**: they ship no content.
- The demo instance, the help centre, and the purge of `refs/pull/*`.

## 9. Open questions (put to Adrien in the summary)

All resolved; the recommended option was taken each time.

- **P18** — Solio's texts by migration on existing databases: **decided 2026-10-06**.
- **P19** — Email phrases on the options: **decided 2026-10-06**. **P19 bis, decided 2026-10-07**: a
  mention may cover several options (rule 7), as Solio's single line for the four juices needs.
- **P20** — **Decided 2026-10-07**: Solio's WordPress site moves to a private repository
  `solio-site`, which Adrien creates.
- **P21** — **Decided 2026-10-07**: « Plus tard » is allowed at every step of the assistant.
- **P22** — **Decided 2026-10-07**: neutral seeds keep linen, breakfast, cleaning, insurance and
  baby bed.
