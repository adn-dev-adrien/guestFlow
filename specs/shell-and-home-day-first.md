# Shell and home — the day first, one way to ask for attention

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/ui-shell-home` |
| **Created** | 2026-10-19 |
| **Author** | Adrien |
| **Related PR** | [#725](https://github.com/adn-dev-adrien/guestFlow/pull/725) |

Source: UI/UX review of 2026-10-18 (`docs/rapports/2026-10-18-ui-ux-review.html`, zone « Coque,
navigation et accueil »), proposals **1**, **14** and **15** retained and decisions **1 to 4**
arbitrated by Adrien on 2026-10-19. Rendering validated before code:
`docs/specs/2026-10-19-shell-and-home-day-first.html` (decision 2 departs from the review's mock: the
late payments stay unfolded too).

---

## 1. Context

- **The home hides the day.** On the Solio copy, seven alert blocks and three KPI tiles come before
  « Départs »: the title sat at 1 302 px at 1280 and 2 195 px at 390 — 2.6 phone screens of scrolling
  before the work of the day.
- **Four recipes for one job.** Ten core alerts and seven plugin alerts were drawn four ways: an
  outlined `Alert` with a 2 px border, a `Card` on the non-existent token `info.lighter` (no background
  at all), a `Card` on `warning.soft`, a plain `Alert`. Every card computed its own title on the client
  (« 2 en retard · 1 à demander », plural forms, earliest shortage date).
- **On a phone nothing says where one is.** The top bar shows « GuestFlow » and the version; the page
  bar hides its title on `xs` unless the page asked for `titleOnXs` — Devis opened on an empty white
  band.
- **The drawer** truncated its labels at 240 px (« Conditions génér… »), its chevrons were `<span>`s
  that a keyboard never reached and that announced nothing, and the menu button had no name.
- **The contrast tokens failed AA**: `warning.main` on `warning.soft` 4.24:1, `success.main` on
  `success.soft` 4.19:1 — the text of the « En retard », « Virement plateforme », « Converti » chips.

## 2. Goal

Opening GuestFlow shows the day's departures and arrivals first; everything that asks for the
operator waits in one counted box, in an order the server decides, drawn by one component. On a phone
the top bar says which page is open.

## 3. Functional rules

### 3.A Home order (proposal 1, decisions 1–2)

1. The home reads, top to bottom: the page bar (date) → the **pinned** subjects → « Départs » →
   « Arrivées » → the box « **À traiter** (n) » → the month calendar. Departures stay before arrivals
   (specs/reception-role-checkin-only.md §6). A reception account sees the two lists only, as before.
2. **The KPI tiles leave the home** (decision 1). Each figure stays reachable elsewhere, so nothing is
   moved: « Logements » → the Suivi financier tile « Logements » (« N logements ») and Paramètres ›
   Logements; « Réservations (30j) » → the Suivi financier tile « Réservations » (« N à venir ») and the
   page « Réservations à venir »; « Arrivées (date sélectionnée) » → the « Arrivées » list right below.
   The home no longer loads the property list nor the 30-day reservation list for them.
3. **Pinned subjects** (decision 2): the gate keys (`gate-keys`, plugin `gate-access`) and the payment
   deadlines (`payment-deadlines`) render unfolded, as cards, above « Départs », whatever their
   severity. Every other subject is a row of « À traiter ». *(Amended 2026-10-19 by rule 21: the
   payment deadlines are pinned only while a line is truly late.)*

### 3.B The attention payload — counts and order from the server

4. `GET /api/dashboard/attention` returns `{ pinned, items, total }`. Each entry is
   `{ key, severity, count, title, detail }` — `severity` ∈ `urgent | todo | info`, `count` ≥ 1, `title`
   and `detail` French, ready to render. A subject whose count is 0 is absent; a broken source never
   breaks the home. *(Amended 2026-10-19 by rule 20: a source that fails is no longer silently absent.)*
5. **Order**: `urgent` before `todo` before `info`; inside a severity, the subject's declared rank. Both
   lists follow it. `total` is the sum of the `items` counts — the « n » of « À traiter (n) »; pinned
   subjects are not in it.
6. **The subjects and their words** (title · detail · severity · rank) are the server's:

   | Key | Title | Detail | Severity | Rank |
   |---|---|---|---|---|
   | `gate-keys` (plugin, pinned) | Clés portail | « Sowel ne lit plus les clés » when stale, else « N clé(s) en échec » | urgent | 10 |
   | `payment-deadlines` (pinned while late, rule 21) | Échéances de paiement | « N en retard · M à demander · K montant(s) à saisir » | worst row: error → urgent, warning → todo, info → info | 20 |
   | `linen-shortage` (plugin) | Stock de linge insuffisant | « N type(s) en rupture à partir du <date> » (the year when not this year) | urgent | 30 |
   | `booking-intake-urgent` (plugin) | Réservations Booking à compléter, arrivée proche | « N fiche(s) à compléter » | urgent | 40 |
   | `ical-date-drift` | Dates iCal à valider | « N changement(s) de dates » | todo | 10 |
   | `ical-cancellation` | Annulations iCal à valider | « N réservation(s) annulée(s) sur la plateforme » | todo | 20 |
   | `cancellation-compensations` | Indemnités d'annulation en attente | « N versement(s) attendu(s) » | todo | 30 |
   | `repaired-reservation-numbers` | Réservations restées sans numéro | « Vérifier qu'il s'agit de vrais séjours » | todo | 40 |
   | `recipe-runs` (plugin) | Calendrier saisonnier | « N point(s) à relire » | todo when a run blocks or event dates are missing, else info | 50 |
   | `gdf-intake` (plugin) | Mails Gîtes de France à vérifier | « N mail(s) » | todo | 60 |
   | `booking-intake` (plugin) | Réservations Booking à compléter | « N fiche(s) à compléter » | todo | 70 |
   | `email-readiness` | Emails incomplets | « N point(s) à compléter avant les prochaines arrivées » | todo | 80 |
   | `new-reservations` | Nouvelles réservations | « Sur les dernières 24 h » | info | 10 |
   | `site-requests` (plugin) | Demandes de devis depuis le site | « N devis en attente » | info | 20 |
   | `email-pending` | Emails à vérifier | « N message(s) à envoyer · M client(s) sans adresse » | info | 30 |
   | `update-available` | GuestFlow X.Y.Z disponible | « Version installée : A.B.C » | info | 40 |
   | `two-factor` | Second code de connexion | « Protéger le compte par un second code » | info | 50 |

7. Each subject's count is the length of the very list its card shows, read through the same server
   handler the card calls — the box and the card can never disagree.
8. The endpoint is admin-only, like every `/api/dashboard/*` route; `two-factor` follows the session's
   own state, `update-available` hides a postponed or running update, `email-readiness` counts what is
   due within 14 days (unchanged rules of their own specs).
9. A plugin contributes a subject with **`ctx.attention({ key, rank, handler, summarize })`** (SDK
   1.3.0): `handler` is its own Express handler of the card's list, `summarize(payload)` returns
   `{ count, title, detail, severity } | null`. The `key` is the key of its client contribution to
   `dashboard.alerts` (or `dashboard.alerts.urgent`), which renders the unfolded content. A plugin that
   is not live contributes nothing.

### 3.C The box « À traiter » (proposal 1)

10. One card titled « À traiter » with the total beside it, then one row per subject: severity glyph,
    title, count, chevron. The row is a button with `aria-expanded`; activating it unfolds the subject's
    content **in place** (its list, its actions), activating it again folds it. Several rows may be
    open. With no subject: « Rien à traiter. »
11. The content of a row is loaded when it unfolds, not before. The counts are read again after every
    write the application makes (a « Reporter », an approval, a check box of the day lists), so a row
    whose last item was handled disappears and the total follows.
12. Motion: unfolding is a height transition, removed under `prefers-reduced-motion: reduce`.

### 3.D One attention component (proposal 15)

13. **`AttentionCard`** draws every dashboard subject, core and plugin: paper background, 1 px
    `divider` hairline (the severity colour for a pinned `urgent`), no shadow, radius 14; a glyph on
    the severity's `soft` background; title in the sans 600; count in a soft chip with tabular figures;
    the detail muted; the actions as text buttons aligned right, **at most one** filled. Inside the box
    (embedded) it draws only the detail, the content and the actions — the row already shows the title.
    The title, detail, count and severity it shows are the server's (rule 6); the card computes none.
14. The palette gains a `text` value per semantic colour, for text on its `soft` background, every one
    ≥ 4.5:1: `success.text #2F6A43` (5.47:1), `warning.text #6F5112` (6.29:1), `error.text` = `#A8433A`
    (5.0:1), `info.text` = `#31556E` (6.67:1). `StatusBadge` writes its label in `<sem>.text`. No
    component reads a token that does not exist (`info.lighter`, `error.lighter` are replaced by `soft`).

### 3.E Page title in the top bar on phones (proposal 14)

15. On `xs` the top bar shows the open page's title, published by its `PageActionBar`, on one line with
    an ellipsis — it is the page's heading (`h1`) there; the home shows the « GuestFlow » wordmark instead,
    as the home's `h1`. `PageActionBar` never draws its
    title on `xs` (the `titleOnXs` prop is removed), and on `xs` a bar with neither back button, actions
    nor tabs is not drawn at all. From `sm` up nothing changes.

### 3.F Drawer (decisions 3–4, parts of the « Tiroir piloté » proposal)

16. The installed version leaves the top bar for the **foot of the drawer** (decision 3): « GuestFlow
    vX.Y.Z », muted, admin only. The update pill stays in the top bar — it is an offer, not a fact.
17. The drawer is **256 px** wide and its labels wrap instead of being cut (decision 4).
18. Each group's chevron is its own button, reachable with the keyboard, with `aria-expanded` and the
    name « Déplier <groupe> » / « Replier <groupe> »; the menu button of the phone bar is named
    « Ouvrir le menu » and carries `aria-expanded`.

### 3.G Fix found on the way

19. The « Aujourd'hui » button of the home's date navigation brings the date back to today (it threw:
    it called a setter that did not exist).

### 3.H Review of PR #725 (2026-10-19)

20. **A source that cannot be read is said, never dropped in silence.** The server logs
    `[attention] source <key> failed: <reason>` and lists the key in `unavailable`; « À traiter » ends
    with « N sujet(s) indisponible(s) » (`unavailableLabel`, server-made). The gate keys are the
    exception: unreadable, they stay pinned, `urgent`, detail « Lecture des clés impossible ».
21. **The payment deadlines are pinned only while a line is truly late** — `deposit_overdue`,
    `balance_overdue`, `cancel_due`, `unpaid_at_arrival`, `platform_payout_overdue`. With only lines to
    request (`*_to_request`) or amounts to type (`platform_amount_missing`), the subject is a row of
    « À traiter ». A missing platform amount is not counted « en retard »: it reads « N montant(s) à
    saisir ».
22. **A plugin package built for SDK < 1.3.0 keeps its home alert.** The payload lists every key it
    asked (`declared`); a `dashboard.alerts(.urgent)` contribution whose key is not among them is
    rendered as before, in card mode under the pinned subjects (`specs/plugins-phase-1-sdk.md` §3.C,
    note of 2026-10-19). The SDK 1.3.0 plugins state `guestflow >=3.10.0`, the convention of the 1.2.0
    bump (the core version of the branch that ships the SDK).

**Edge cases:**
- No subject at all → no pinned card, « À traiter » with « Rien à traiter. »
- A plugin whose handler throws → its subject is absent; the others render.
- A very long title (a property name in a detail, a page title on `xs`) wraps in the box and ellipsizes
  in the top bar; nothing scrolls sideways at 390 px.
- 99+ in a count → the chip shows the number as is (tabular figures, no truncation).

---

## 4. Architecture

> Fat backend: which subjects exist, their counts, severities, order, titles and details are built on
> the server. The client renders the payload and keeps only open/closed row state.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `dashboard.js` | T | `GET /attention`; wires the core sources (`coreAttentionSources`, exported for the key check) |
| `routes/` | `emails.js`, `emailReadiness.js` | T | Export their controller so the attention read calls the same handler |
| `controllers/` | `dashboardAttentionController.js` | C | Reads every core subject and every live plugin subject through their own handlers, builds the payload |
| `utils/` | `dashboardAttention.js` | C | Pure: severities, core subject summaries (titles, details, plurals), filter/sort/split/total |
| `utils/` | `handlerPayload.js` | C | Runs an Express handler in-process: `{ ok, body }` or `{ ok: false, reason }` (rule 20) |
| `plugins/sdk/` | `createContext.js`, `registry.js`, `version.js` | T | `ctx.attention(...)`, record field `attention`, SDK 1.3.0 |
| `plugins/gate-access/` | `index.js`, `attention.js`, `manifest.json` | T | Subject `gate-keys` (pinned) |
| `plugins/linen/` | `index.js`, `attention.js`, `manifest.json` | T | Subject `linen-shortage` |
| `plugins/tariff-recipes/` | `index.js`, `attention.js`, `manifest.json` | T | Subject `recipe-runs` |
| `plugins/gites-de-france-intake/` | `index.js`, `attention.js`, `manifest.json` | T | Subject `gdf-intake` |
| `plugins/booking-intake/` | `index.js`, `attention.js`, `manifest.json` | T | Subjects `booking-intake`, `booking-intake-urgent` |
| `plugins/website-booking/` | `index.js`, `attention.js`, `manifest.json` | T | Subject `site-requests` |
| `plugins/hourly-resources/`, `online-payment/`, `accounting-export/` | `manifest.json` | T | Version bump only (their client pages drop `titleOnXs`) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `Dashboard.jsx` | T | New order, no KPI tiles, pinned + box, « Aujourd'hui » fix |
| `components/` | `AttentionCard.jsx` | C | Generic: one dashboard subject, card or embedded |
| `components/` | `AttentionInbox.jsx` | C | Generic: the « À traiter » box (rows, unfold in place, unavailable line), the pinned cards, and `LegacyPluginAlerts` for SDK < 1.3.0 packages |
| `components/` | `attentionSubjects.js` | C | Key → component of each core subject, plus the plugin contributions by key |
| `components/` | the ten core `*Alert.jsx` / `TwoFactorNudgeCard.jsx` | T | Render through `AttentionCard` with the server's `attention` |
| `components/` | `PageActionBar.jsx` | T | Publishes its title; no title on `xs`; empty bar not drawn on `xs`; `titleOnXs` removed |
| `components/` | `AppVersionBadge.jsx` | T | Top bar: update pill only; `AppVersionFooter` export for the drawer foot |
| `components/` | `StatusBadge.jsx` | T | Label in `<sem>.text` |
| `components/` | `EmailComposeDialog.jsx`, `EmailLogViewDialog.jsx`, `EmailManualSendDialog.jsx` | T | `*.lighter` → `*.soft` |
| `hooks/` | `usePageTitle.jsx` | C | Context: the page bar publishes, the top bar reads |
| `hooks/` | `useAttention.js` | C | Loads `/dashboard/attention`, reloads after writes |
| `api.js` | `api.js` | T | `getAttention()`; every successful write dispatches `guestflow:data-changed` |
| `theme.js` | `theme.js` | T | `<sem>.text` tokens |
| `App.jsx` | `App.jsx` | T | Title on `xs`, 256 px drawer, wrapping labels, chevron buttons, version foot, menu button name |
| `plugins/sdk/` | `index.js` | T | Exports `AttentionCard` |
| `plugins/*/` | the seven plugin alerts | T | Render through `AttentionCard` |
| pages using `titleOnXs` | 17 files | T | Prop removed |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed** | `PageActionBar`, `ResponsiveTable`, `StatusBadge`, `CumulativeMonthCalendar`, `ErrorAlert`, `LoadingState` | |
| **Created (generic)** | `AttentionCard`, `AttentionInbox` | Every dashboard subject, core and plugins (via the SDK); the console and Finance are next candidates for a counted inbox. |
| **Specific** | — | |

### 4.3 API contract

| Method | Endpoint | Response | Notes |
|---|---|---|---|
| GET | `/api/dashboard/attention` | `{ pinned: Subject[], items: Subject[], total: number, unavailable: string[], unavailableLabel: string, declared: string[] }`, `Subject = { key, severity, count, title, detail }` | Admin only. Never fails because of one subject; a failing one is named (rule 20). |

## 5. Data model

None.

## 6. UI / UX

- **Home, desktop (≥ 1200)**: bar « Tableau de bord » with the date cluster centred; pinned cards
  (gate keys, payment deadlines) full width; « Départs » and « Arrivées » tables; the « À traiter »
  card; the month calendar.
- **Home, tablet (~900)**: same order; tables as today.
- **Home, phone (≤ 600)**: top bar « ☰ GuestFlow 🔍 » (wordmark on the home); the date strip; pinned
  cards; departures and arrivals as cards; the box, rows 44 px high, titles wrapping; the actions of an
  unfolded row stack.
- **Other pages, phone**: top bar « ☰ <titre de la page> 🔍 »; the page bar holds only back, tabs and
  actions, and disappears when it would be empty.
- **Drawer**: 256 px, labels on two lines when needed, chevron buttons (44 px on touch), « GuestFlow
  vX.Y.Z » at its foot for an admin.
- **Copy**: « À traiter », « Rien à traiter. », « Déplier … » / « Replier … », « Ouvrir le menu »,
  subject titles and details of rule 6.

## 7. Test plan

### Server unit tests
- [x] `tests/dashboard-attention.unit.test.js` — rules 4–9, 20–21 (summaries, order, split, total,
  failing source named and logged, conditional pinning, plugin subjects through `ctx.attention`).
- [x] `tests/dashboard-attention-routes.unit.test.js` — rules 6, 8 (403 for reception and accountant,
  support session without the 2FA nudge, every core key has a summary and a client component).

### Client tests (Vitest)
- [x] `components/__tests__/AttentionCard.render.test.jsx` — rules 13, 14.
- [x] `components/__tests__/AttentionInbox.render.test.jsx` — rules 3, 5, 10, 11, 20, 22.
- [x] `pages/__tests__/Dashboard.day-first.test.jsx` — rules 1, 2, 19.
- [x] `components/__tests__/PageActionBar.mobile-title.test.jsx` — rule 15.
- [x] `__tests__/App.drawer.test.jsx` — rules 16–18.
- [x] The existing alert suites updated to the `attention` prop.

### E2E
- [x] Updated: `auth/dashboard-loads`, `ical/*-card-appears`, `mobile/*` (title in the top bar).

### Manual UI verification
- [x] 390 / 900 / 1280 on a neutralised copy of the Solio base: day first, box unfolds, pinned cards,
  no horizontal scroll at 390, drawer labels wrap, title in the top bar on a phone.

## 8. Out of scope

- The rest of the « Tiroir piloté » proposal (data-driven tree, one group open at a time, properties
  loaded once) — only decisions 3–4 are taken here.
- The bar material (proposal 4), typography tracking and reduced-motion theme rule (proposal 7), the
  empty-day line (proposal 8).
- « Marquer traité » on a row: each subject keeps the dismiss its own spec gives it.

## 9. Open questions

- Q: KPI tiles — leave, or one line of text? A (2026-10-19, decision 1): they leave.
- Q: Which alerts stay unfolded? A (2026-10-19, decision 2): gate keys and late payments.
- Q: Where does the installed version go? A (2026-10-19, decision 3): foot of the drawer.
- Q: Drawer width? A (2026-10-19, decision 4): 256 px with wrapping.
