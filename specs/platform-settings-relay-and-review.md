# Platform settings: relay address and review wording — and the other names the core stopped knowing

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/audit-2026-10-27-genericity` |
| **Created** | 2026-10-27 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

GuestFlow is sold to other operators. The 2026-10-27 audit (lot 5, genericity) found core code paths that
recognised a channel or a provider by its name, or spoke Solio's vocabulary:

- `utils/guestEmailSequence.js` treated every platform whose name starts with « airbnb » or « booking »
  as a relay address (no season e-mail), and labelled the reason « Adresse relais Airbnb / Booking ».
- `utils/stayContentContext.js` wrote the J+1 review sentence with three hard-coded wordings
  (« votre espace Gîtes de France », « Airbnb », « Booking »).
- `controllers/pushController.js` and `SettingsPushNotificationsSection.jsx` knew the Neat plugin's push
  toggle by name (« Souscriptions Neat »).
- `controllers/paymentsController.js` handled Qonto's `QONTO_NOT_CONNECTED`; the insurance refusals said
  « plugin Neat ».
- The start assistant's options question cited « bain nordique »; the settings search carried
  « Planche », « Bain nordique » and the words of plugin pages (recipes, linen, Qonto) in the core.
- The « Code portail » field of Établissement was drawn by the core (« portail du domaine »).
- One platform had two labels: the server said « Gîtes de France », the client chips « GitesDeFrance ».
- `reservation.platform` was titled « Canal » on some screens and « Plateforme » on others.

The model to follow is `platforms.forbidsGuestChores` (specs/airbnb-no-checkout-chores.md rules 8–9):
an operator setting per platform, a cached set read by the code, and a one-shot migration that writes
today's knowledge onto an existing database only.

## 2. Goal

Another operator configures how each of its platforms treats guest e-mails, and no core screen, message
or e-mail names Solio's platforms, resources or plugins — while every e-mail Solio's guests receive stays
byte-identical, with one accepted exception: a platform without a review wording is now named by its
display name, so a GreenGo guest's J+1 reads « GreenGo » (the brand's spelling) instead of the stored
« Greengo » (reviewed 2026-10-27).

## 3. Functional rules

1. **« Adresse e-mail relais »** is a per-platform switch (`platforms.relaysGuestEmail`, default off): the
   platform hands out a relay address instead of the guest's own. An own channel (`direct`, or counted as a
   direct sale) has none: the settings page shows « — » and a save never writes it.
2. The guest e-mail sequence reads `isRelayChannel(platform)` (`utils/platformNameFormat.js`, a cached set
   re-read at boot and after every platform save), never a platform name. A client whose past stays are all
   on relay platforms gets no season e-mail; the operator-facing reason reads « Adresse e-mail relais de la
   plateforme ».
3. **« Où laisser un avis »** is a per-platform wording in French and English (`platforms.reviewWhereFr`,
   `reviewWhereEn`, 80 characters at most each): the end of « quelques mots sur … » in the J+1 e-mail.
4. The J+1 review paragraph reads `platformReviewWhere(platform, lang)`. An empty English answers the
   French; nothing written answers the platform's display name (rule 12). An own channel keeps the Google
   path of the direct stays.
5. Paramètres › Plateformes edits both in a second table, « E-mails aux voyageurs » (one card per platform
   below `lg`). A wording over 80 characters refuses the whole save, field in red, nothing written.
6. One-shot migration `platform_guest_contact_v1` (`utils/platformGuestContactMigration.js`): on an
   existing database it ticks « Adresse e-mail relais » on the rows whose letters start with `airbnb` or
   `booking`, and writes the three former wordings on the matching rows (`gitesdefrance`/`gite…` →
   « votre espace Gîtes de France » / « your Gîtes de France account »; `airbnb…` → « Airbnb »;
   `booking…` → « Booking »). It runs once: an operator who unticks keeps it unticked; a new database has
   nothing ticked nor written. The boot de-duplication (`utils/platformSlugDedupMigration.js`) merges the
   three columns like the other switches.
7. Proof of identity: for Gîtes de France, Airbnb and Booking, in French and English, with and without a
   Google link, the J+1 paragraph after the migration equals the one the hard-coded names produced
   (`tests/fixtures/platform-review-paragraphs-before.json`).
8. **Push channels are contributed.** A plugin declares its toggle with `ctx.pushChannel({ key, label })`
   (SDK 2.6.0); `GET/PUT /api/push/preferences` answers the core channels then the live plugins' ones as
   `channels: [{ key, label }]` (and `available`, their keys), and the settings card renders that list as
   is. A plugin channel's toggle lives in `user_push_channel_prefs` (default ON); a send to a key no plugin
   declared reaches nobody. Migration `push_channel_prefs_v1` carries the former `user_push_prefs.neat = 0`
   choices over. The neat plugin declares « Souscriptions Neat ».
9. **Provider names stay with the provider.** A payment provider may word its own errors through the
   optional `describeError(err) → { httpStatus, error, message } | null` of its contract
   (`utils/paymentProviders.js`); the core's money path no longer knows `QONTO_NOT_CONNECTED` (the Qonto
   provider of `online-payment` answers it). The insurance refusals read « L’assurance annulation demande
   un plugin d’assurance actif. », « … n’est pas proposée sans plugin d’assurance actif. » and « Lecture
   seule : aucun plugin d’assurance actif ».
10. **Words of the plugins come from the plugins.** A plugin page brings its settings-search words on its
    `settings.menu` entry (`keywords`); a plugin adds words to a core page through the `settings.keywords`
    slot (`{ key, path, keywords }`), counted only while the plugin is live. The core keeps no « Planche »
    nor « Bain nordique »; hourly-resources brings « Ressources à l’heure », « Créneaux », « Sauna », « Spa »
    to Options & ressources. The start assistant's options question reads « Des options payantes à
    l’arrivée : repas, linge, sauna ou spa ? ».
11. **« Code portail » is the SAS's.** The field sits in Paramètres › Établissement through the
    `settings.etablissement` slot (props `values`, `onChange(key, value)`, `disabled`), contributed by the
    `sas` plugin with the neutral helper « Code d’accès communiqué au client à l’arrivée (SAS). » and its
    search word through `settings.keywords`. The setting itself (`portalCode`) is unchanged.
12. **One label per platform.** `GET /api/properties/platform-colors` carries `displayNames`
    (`{ [platform name]: platformDisplay(name) }`); the client loads it once (App) and
    `formatPlatformLabel` / `PlatformChip` render it (« Gîtes de France », « GreenGo »), falling back to
    the stored spelling with its leading capital until it arrives. `PlatformChip` re-renders when it does.
13. **« Plateforme »** names `reservation.platform` everywhere: the « Encaissé » and « Réservations »
    tables of the Suivi financier and the fiche's section. « Canal » stays the « Canaux de réservation »
    tile's own concept.

**Edge cases:**
- A platform counted as a direct sale after being ticked relay → not a relay, no switch shown.
- A reservation on a platform with no `platforms` row → not a relay; the review wording falls back to its
  display name.
- Neat inactive → its toggle disappears from the card; the stored choice is kept for its return.

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `platformGuestContactMigration.js` | C | Columns + one-shot `platform_guest_contact_v1` (rule 6) |
| `utils/` | `platformNameFormat.js` | T | `isRelayChannel`, `platformReviewWhere`, their setters, `refreshGuestContactChannels` (rules 2, 4) |
| `utils/` | `guestEmailSequence.js` | T | Reads `isRelayChannel`; neutral reason label (rule 2) |
| `utils/` | `stayContentContext.js` | T | J+1 wording from the platform setting, display name fallback (rule 4) |
| `utils/` | `platformSlugDedupMigration.js` | T | Merges the three new columns (rule 6) |
| `models/` | `platformsModel.js` | T | Serves and writes the two settings; refresh after save (rules 1, 3, 5) |
| `controllers/` | `platformsController.js` | T | Validates and saves them; never on an own channel (rule 5) |
| `utils/` | `pushChannels.js` | C | Core channels + live plugin channels with labels (rule 8) |
| `utils/` | `pushChannelPrefsMigration.js` | C | `user_push_channel_prefs` + `push_channel_prefs_v1` (rule 8) |
| `models/` | `pushSubscriptionsModel.js` | T | Plugin channel toggles in their own table; sends only to declared channels (rule 8) |
| `controllers/` | `pushController.js` | T | Serves `channels` / `available` without naming a plugin (rule 8) |
| `plugins/sdk/` | `createContext.js`, `registry.js`, `version.js`, `coreModules.json` | T | `ctx.pushChannel`, SDK 2.6.0, new core exports (rule 8) |
| `plugins/neat/` | `index.js`, `manifest.json` | T | Declares « Souscriptions Neat » (1.3.0, SDK ^2.6.0) |
| `utils/` | `paymentProviders.js` | T | Optional `describeError` in the provider contract (rule 9) |
| `controllers/` | `paymentsController.js` | T | Answers a provider-described error as is; no Qonto code (rule 9) |
| `plugins/online-payment/` | `provider.js`, `manifest.json` | T | Words `QONTO_NOT_CONNECTED` itself (1.3.0) |
| `controllers/` / `utils/` | `optionsController.js`, `insuranceOffer.js` | T | Neutral insurance wording (rule 9) |
| `constants/` | `onboardingQuestions.js` | T | Neutral examples (rule 10) |
| `models/` | `propertiesModel.js` | T | `displayNames` in the platform colours payload (rule 12) |
| `database.js` | `database.js` | T | Wires both migrations and the cache refresh |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/settings/` | `PlatformsSettingsPage.jsx` | T | « E-mails aux voyageurs » table / card fields (rule 5) |
| `pages/settings/` | `SettingsHomePage.jsx` | T | Search words from plugin entries and `settings.keywords` (rule 10) |
| `constants/` | `settingsMenu.js` | T | Core words only; `settingsKeywordsOf(entry, contributed)` (rule 10) |
| `components/` | `SettingsCompanySection.jsx` | T | `settings.etablissement` slot instead of the portal field (rule 11) |
| `components/` | `SettingsPushNotificationsSection.jsx` | T | Renders the server's `channels` (rule 8) |
| `constants/` | `platforms.js` | T | Display names map + subscription; `formatPlatformLabel` reads it (rule 12) |
| `components/` | `PlatformChip.jsx` | T | Re-renders when the names arrive (rule 12) |
| `App.jsx` | `App.jsx` | T | Loads the names with the colours (rule 12) |
| `components/` / `pages/` | `FinanceDetailPanel.jsx`, `ReservationPage.jsx` | T | « Plateforme » (rule 13) |
| `plugins/sas/` | `SettingsPortalCodeField.jsx`, `index.js` | C/T | The portal field and its search word (rule 11) |
| `plugins/hourly-resources/`, `tariff-recipes/`, `linen/`, `online-payment/` | `index.js` | T | Their search words (rule 10) |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `Slot`, `PlatformChip`, `ErrorAlert`, `LoadingState` | |
| **Created (new generic)** | — | |
| **Specific (kept feature-local)** | `SettingsPortalCodeField` (sas) | One field of one plugin. |

### 4.3 API contract

| Method | Endpoint | Change |
|---|---|---|
| GET | `/api/platforms/settings` | Each row adds `relaysGuestEmail` (bool, null on own channels), `reviewWhereFr`, `reviewWhereEn` (string, null on own channels) |
| PUT | `/api/platforms/settings` | Rows accept `relaysGuestEmail`, `reviewWhereFr`, `reviewWhereEn`; `PLATFORMS_INVALID` with `« 80 caractères au plus. »` |
| GET/PUT | `/api/push/preferences` | Adds `channels: [{ key, label }]`; plugin keys only while live; PUT accepts the live plugin keys |
| GET | `/api/properties/platform-colors` | Adds `displayNames: { [name]: label }` |

---

## 5. Data model

- `platforms.relaysGuestEmail INTEGER NOT NULL DEFAULT 0`, `platforms.reviewWhereFr TEXT`,
  `platforms.reviewWhereEn TEXT` — added on every boot when missing.
- `user_push_channel_prefs (userId, channel, enabled, PRIMARY KEY (userId, channel))`. The former
  `user_push_prefs.neat` column stays in place, read once by `push_channel_prefs_v1`.

**Data impact:** additive. The migrations write what the code used to decide by name; Solio's e-mails and
exclusions are unchanged (rule 7).

## 6. UI / UX

- **Paramètres › Plateformes** (`lg`+): under the main table, a card « E-mails aux voyageurs » with a short
  caption and a table « Plateforme · Adresse e-mail relais · Où laisser un avis · En anglais »; own
  channels are not listed. Below `lg` (tablet, mobile): each platform card adds the switch « Adresse
  e-mail relais » and the two fields. The English field's placeholder is the French wording.
- **Paramètres › Établissement**: unchanged look; the « Code portail » field comes from the SAS.
- **Notifications push**: unchanged look; the list is the server's.
- Chips read « Gîtes de France »; the fiche's section is titled « Plateforme ».
- `PageActionBar` unchanged on every page touched.

## 7. Test plan

### Server unit tests
- [x] `tests/platform-settings-relay-and-review.unit.test.js` (8) — migration, one shot, new database,
  season mails read the switch, byte-identical J+1 (rule 7), other wordings and fallbacks, settings
  served / saved / refused, own channel never written.
- [x] `tests/push-plugin-channels.unit.test.js` (4) — `ctx.pushChannel` validation, channels while live,
  saved toggle, `neat` migration and undeclared key.
- [x] `tests/payment-provider-describes-errors.unit.test.js` (2) — Qonto words its error; another provider
  likewise; the core's generic 502 otherwise.
- [x] `tests/platform-display-names-served.unit.test.js` (1) — `displayNames` equals `platformDisplay`.
- [x] Updated: `guest-email-sequence-exclusions`, `stay-content-context`, `push-subscriptions-model`,
  `insurance-offer-follows-neat`, `insurance-price-plugin-off`.
- [x] `productisation-golden` (phase P rule 26): its Solio fixture now runs `platform_guest_contact_v1`
  on its platforms, and the six sequence e-mails, FR and EN, still render byte for byte as the golden.

### Client unit tests
- [x] `pages/settings/__tests__/PlatformsSettingsPage.relay-and-review.test.jsx` (2)
- [x] `pages/settings/__tests__/SettingsHomePage.plugin-keywords.test.jsx` (6)
- [x] `components/__tests__/PlatformChip.display-name.test.jsx` (2)
- [x] `components/__tests__/FinanceDetailPanel.platform-column.test.jsx` (2)
- [x] `components/__tests__/SettingsPushNotificationsSection.available.test.jsx` (+2)
- [x] Updated: `SettingsCompanySection.portal-code`, `settingsMenu.groups`, `SettingsPushNotificationsSection`.

### Manual UI verification
- [ ] Plateformes at 390 / 900 / 1280 px: the switch and the two fields, a too-long wording refused.
- [ ] Établissement with the SAS on: « Code portail » present; off: absent.
- [ ] Settings search « sauna » with hourly resources on.

## 8. Out of scope

- The client's `PLATFORMS` list and colour defaults, the « Plateformes » search words naming channels, and
  the server's `PLATFORM_DISPLAY` map: they are display defaults, not behaviour.
- `PlatformPriceCard.jsx` (audit lot 7).

## 9. Open questions

- Q: Should the display name itself become an operator setting?
  - A: Not now (2026-10-27): the server map covers the known spellings; revisit when an operator asks.
