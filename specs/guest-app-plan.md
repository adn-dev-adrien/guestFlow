# Guest app « Mon séjour » — implementation plan

Companion to [guest-app.md](guest-app.md) (the spec) and
[guest-app-maquettes.html](guest-app-maquettes.html) (charter, prototype, screens). Rule numbers refer to
spec §3.

**Status:** Validated (2026-11-05) — slice A implemented, see spec §10
**Base branch:** `inte/plugins` (the integration branch whose public API, plugin SDK and payment links this
work builds on). Each slice is one branch `feature/guest-app-<slice>` cut from an up-to-date
`inte/plugins`, one PR, squash-merged.
**Surface (estimate):** 1 new plugin (`guest-app`, ~30 server files), 2 new front-end apps (`apps/guest`,
`apps/studio`), 1 plugin client module, ~12 touched core / plugin files, ~18 new server test files,
~10 client test files, 1 E2E suite.

The work splits into eight shippable slices. Each leaves the app working: until slice F ships, the
plugin is installable but has no guest-facing screen, and nothing in the core changes behaviour while it
is not installed (rule 22). The order puts the money path (D) after its foundations (A-C) and before any
guest UI, so the riskiest code is the most tested before a guest can reach it.

| Slice | What it delivers | Depends on |
|---|---|---|
| **A — Plugin, lodgings, sessions** | Plugin skeleton, per-lodging config, QR codes, current stay, sessions, lookup, `/me`, `/lodging` | — |
| **B — Sellable catalogue** | `guest_app_items`, the editor contribution in GuestFlow, `/shop` with per-lodging prices and free / included states | A |
| **C — Planning and service hours** | Bath slots from the resource planning (SDK hook in `hourly-resources`), holds, service hours, delivery slots, ignition rule | B |
| **D — Orders and payment** | Quote, note / 0 € / card orders, core commit to the fiche, `complement` payment links, expiry, push, planning card, *Commandes app* page | C |
| **E — Booklet and studio API** | Pages, placements, blocks, versions, media, publish, search, QR poster | A |
| **F — Guest PWA** | `apps/guest`: the whole guest app of §6, offline booklet, install | A-E |
| **G — Studio** | `apps/studio`: lodging switcher, modules & infos, booklet editor with live preview, shop presentation, service hours | E, F (preview components) |
| **H — Hardening and rollout** | E2E, accessibility and bundle checks, guest host in production, release | all |
| **I — Booklet content** | Both booklets entered from the user's own complete booklets (placeholder pages until then) | E, the booklets |

---

## 0. Prerequisites

- [ ] Spec `guest-app.md` moved to `Approved` (2026-11-04). The open items of §9 (paper booklets, guest
      host name, app name, Soliomap framing, launch catalogue and service hours) are **content and
      configuration**: they block slice H, not the code.
- [ ] `cd server && npm test` and `cd client && npm test` green on `inte/plugins`; record the counts as
      the baseline (962 server test files today).
- [ ] Verify on `inte/plugins` that nothing has moved under the hooks this plan extends
      (`midStayExtrasWindow.js`, `paymentRequestService.js` `ensurePaymentLink`,
      `paymentPollRunner.js` `applyPaidEffect`, `hourly-resources/availability.js`, `occupancyModel.js`,
      `gate-access/window.js`). Any drift → stop and re-plan the touched step.

---

## Slice A — Plugin, lodgings, sessions (rules 1-11quater)

### A1 — Shared stay window moves to the core
1. Extract `plugins/gate-access/window.js` into core `utils/stayWindow.js` (same functions, same tests
   moved), `gate-access` imports it through `sdk.coreModule('stayWindow')` (one line in
   `coreModules.json`). Reason: the guest app needs the window even when `gate-access` is not installed.
2. Gate-access tests stay green unchanged — the proof that nothing moved.

### A2 — Plugin skeleton
3. `server/src/plugins/guest-app/manifest.json` (`id: guest-app`, « Application clients », `requires: []`,
   surfaces listed), `index.js` `register(ctx)`: migrations, `ctx.settings.declare` (app name, guest host,
   Soliomap URL + embed, max order total), `ctx.pushChannel({ key: 'guest-orders', label: 'Commandes
   clients' })`, `ctx.mount('/public/v1/guest', …)`, `ctx.mount('/api/guest-app', …)`.
4. `migrations.js`: every table of spec §5 in one `guest_app_tables_v1`, idempotent.
5. Client module `client/src/plugins/guest-app/index.js` registered like the others; its
   `settings.integrations` card (« Application clients »: guest host; the link to the studio joins it in slice G).

### A3 — Lodging configuration (rules 11bis-11quater)
6. `models/lodgingsModel.js`: read / write `guest_app_lodgings`; the wifi password through the core
   encryption helper; `lodgingCode` generated (128 bits, base64url) when a lodging is enabled, never logged;
   a property created later is inserted `enabled = 0`.
7. `controllers/lodgingsController.js` + `GET/PUT /api/guest-app/lodgings/:propertyId`, admin only,
   input validated at the boundary (module keys from a closed list, order a permutation, wifi fields
   bounded).
8. Pure `modules.js`: resolve the shown modules from config + prerequisites (rule 11bis).

### A4 — Current stay and sessions (rules 1-9)
9. Pure `currentStay.js` (lodging + instant → stay | preArrival | visitor; changeover rule 3; J-7 window
   of rule 6), pure `nameMatch.js` (rule 7).
10. `models/sessionsModel.js` (token SHA-256, expiry = window end, purge 30 days after),
    `middleware/guestSession.js` (re-derive the window on each request, 401 `SESSION_EXPIRED`, dead on
    cancel / delete).
11. `controllers/sessionController.js`: `POST /sessions`, `POST /sessions/lookup` (generic 404, constant
    time), `GET /me` (rule 8 minimisation), `POST /me/confirm-name` (3 failures → 1 h lock),
    `GET /lodging`. Cookie `gf_guest` `HttpOnly; Secure; SameSite=Strict`.
12. `middleware/rateLimiters.js`: `guestSessionLimiter`, `guestLookupLimiter` (env-overridable like the
    others).
13. Pure `homeHighlight.js` (status line + single highlight, rules 10-11) with a clock argument.

### A5 — Tests (one file per subject, `server/src/plugins/guest-app/tests/`)
- `guest-app-current-stay.unit.test.js` — rules 2, 3, 5, 6, 9 incl. DST and changeover edges.
- `guest-app-name-match.unit.test.js` — rule 7.
- `guest-app-sessions.unit.test.js` — rules 1, 4, 6, 8, throttling, generic errors, payload minimisation.
- `guest-app-lodging-config.unit.test.js` — rules 11bis-11quater, wifi encrypted at rest.
- `guest-app-home.unit.test.js` — rules 10-11.
- `guest-app-plugin-gating.unit.test.js` — inactive → 404 `PLUGIN_INACTIVE`, rows kept, no core column.
- `stay-window.unit.test.js` (moved gate-access window tests, unchanged assertions).

---

## Slice B — Sellable catalogue (rules 22-27)

### B1 — The sell switch lives in the plugin
14. `models/itemsModel.js` + `controllers/itemsController.js`, `GET/PUT /api/guest-app/items/:kind/:id`.
    Refuses a non-sellable price type with the reason (rule 23).
15. Core client: new contribution point `options.fields` in `pages/options/OptionEditorPanel.jsx`, rendered
    exactly like `resources.fields` in `ResourceEditorPanel.jsx` (`useSlot`); empty when no live plugin
    contributes — the only core client change of the feature.
16. `client/src/plugins/guest-app/GuestAppItemFields.jsx` contributed to both points: switch « Vendu dans
    l'app », photo, short description FR/EN, « Préparé par l'équipe », « Délai de préparation »,
    « Quantité max. »; saves through its own endpoint (no change to the option / resource payloads).

### B2 — The lodging's shop
17. Export `toPublicOption` / `toPublicResource` from `website-booking/publicProjections.js` to the core
    projection helpers (move to `utils/publicCatalogProjection.js`, website-booking imports it) — the guest
    app must not depend on `website-booking` being installed.
18. Pure `sellable.js`: lodging scope, sellable types, per-lodging price 0 → included, free units (direct
    only, through the core `applyFreeUnitsToLine`) and free minutes left after the stay's existing lines and
    previous orders, offered-by-default already on the stay (rule 25).
19. `controllers/shopController.js` `GET /public/v1/guest/shop` (shop open = `midStayExtrasWindow`, rule 27;
    `canPayCard` from the payment provider state).

### B3 — Tests
- `guest-app-sellable.unit.test.js` — rules 23, 25 (one lodging free, the other paid; free units direct
  only; free minutes after a SAS session).
- `guest-app-items.unit.test.js` — rule 22-23 validation.
- Client: `OptionEditorPanel.plugin-fields.test.jsx` (slot renders nothing without a plugin),
  `GuestAppItemFields.test.jsx`.
- Regression: website-booking projection tests green after the move.

---

## Slice C — Planning and service hours (rules 28-31, 39-42)

### C1 — An SDK hook, not a cross-plugin import
20. New SDK hook `ctx.resourceScheduler(provider)` (one provider app-wide, like `paymentProvider`):
    `{ slotsForStay, validateSessions, holdsSource }`. `hourly-resources` declares it, built on its own
    `occupancyModel.listRange`, `availability.buildDays` / `validateBlock`, `hourlyPricing.priceSessions`.
    The core exposes `coreServices.resourceScheduler()` (null when `hourly-resources` is inactive →
    hourly items absent, rule edge case).
21. `holdsSource`: `hourly-resources` asks every declared holds source for pending occupancy, so a guest
    order awaiting payment blocks the slot in the planning page, the SAS picker and outside bookings too
    (rule 35). `guest-app` declares `ctx.resourceHolds(fn)` reading `guest_orders.heldUntil`.
22. `slotsForStay` returns states `free | evening | taken | closed | heating | staff | past` and a
    `reasonLabel`; the `staff` state comes from a predicate the caller passes (C2).

### C2 — Service hours
23. `models/serviceHoursModel.js`, `GET/PUT /api/guest-app/service-hours` (weekly ranges ≤ 3 per day,
    exceptions, optional per lodging).
24. Pure `serviceHours.js`: ranges for a date (exceptions and all-properties establishment closures
    applied), next opening, delivery slots from `now + max(leadMinutes)` to check-out in 30-min steps,
    `ignitionInHours(slot, heatUpMinutes, warm)` for rule 31.
25. `GET /shop/resources/:id/slots`, `POST /shop/delivery-slots`.

### C3 — Tests
- `server/src/plugins/hourly-resources/tests/resource-scheduler-hook.unit.test.js` — other stays, outside
  bookings, holds, turnover, capacity, heat-up / retention, closed days, evening rate, multi-slot order;
  the SAS picker and the planning see held slots.
- `guest-app-slots.unit.test.js` — ignition outside service hours → `staff`, warm slot unconstrained.
- `guest-app-service-hours.unit.test.js` — rules 39-42.
- Regression: every existing `hourly-resources` test green (no behaviour change without a holds source).

---

## Slice D — Orders and payment (rules 32-38, 43-46)

### D1 — The core commit (money stays core)
26. Core `utils/guestOrderCommit.js`: one transaction — add option quantities to the existing line or
    create it, add resource sessions to the stay's `reservation_resources` line (raising sold hours), all
    through the same path as `PUT /api/reservations/:id` on a locked fiche (`ARRIVAL_EXTRAS_FROZEN` /
    `MID_STAY_EXTRAS_CLOSED` respected), history entry « Commande app #N », optional `complement`
    payment recorded in the ledger. Exposed in `coreModules.json`.
27. `tests/guest-order-commit.unit.test.js` (core): note → `endOfStayComplementDetail` lines
    `source:'midStayExtra'`; paid → lines + ledger payment, complement unchanged; quantities merge; closed
    window refused.

### D2 — Quote and orders
28. `POST /orders/quote` priced by the core engine (same function as the fiche); `POST /orders` with
    `payment: note | none | card`, `NAME_REQUIRED`, `SLOT_TAKEN`, `DELIVERY_SLOT_GONE`, `SHOP_CLOSED`,
    `ORDER_LIMIT`; `guestOrderLimiter`; `GET /orders`, `GET /orders/:id`.
29. `models/ordersModel.js`; priced snapshot in `linesJson`.

### D3 — Card payment: wire the `complement` link type
30. `utils/paymentRequestService.js`: `ensurePaymentLink` accepts `complement` **only** with an explicit
    basket `{ source: 'guestOrder', orderId, lines }`; VAT basket from the lines; lifetime 30 min; exempt
    from the arrival-day lapse.
31. `utils/paymentPollRunner.js`: `applyPaidEffect` `complement` branch → `guestOrderCommit`; late payment
    after expiry → commit if slots still free, else `paid_conflict` + push.
32. Return URL on the guest host (`/commande/:id`), added to the allowed return origins next to
    `publicSiteOrigin`.
33. `orderExpiryRunner.js` via `ctx.jobs.every` (1 min): expire, release holds.
34. `tests/payment-complement-link.unit.test.js` (core) — refusal without basket, 30-min lifetime,
    no lapse, paid effect. `guest-app-order-card.unit.test.js` — rules 35-36.
    `guest-app-order-note.unit.test.js` — rules 33-34 (name only for the note, lock, 0 € without name).

### D4 — Staff side
35. Push on confirmed / paid (rule 44) through `pushService.sendToPref('guest-orders', …)`.
36. `planning.days` contribution `PlanningOrderCard.jsx` + server feed `planningCards.js` (rule 43).
37. `GuestOrdersPage.jsx` (route `/commandes-app`, sidebar entry, `PageActionBar` « Actualiser »,
    cards on `xs`, table on `md+`), `POST /api/guest-app/orders/:id/delivered`.
38. Client tests: `GuestOrdersPage.test.jsx`, `PlanningOrderCard.test.jsx`.

---

## Slice E — Booklet and studio API (rules 16-21, 47-50)

39. `models/bookletModel.js`: pages, placements per lodging, blocks with `onlyForPropertyIdsJson`,
    versions per lodging; `resolveBooklet(propertyId, lang)` (placements in order, restricted blocks
    filtered, lodging facts injected into `wifi` / `contact` blocks, EN → FR fallback).
40. Block validation per type (closed list, rule 18), rich text sanitised server-side (allow-list:
    paragraphs, bold, italic, lists, links `https:` / `tel:` / `mailto:`).
41. `mediaModel.js` + upload through `multer` (already a server dependency), resize to 1600 / 800 / 400
    WebP with `sharp` (already a server dependency), size and type limits at the boundary.
42. Studio endpoints: CRUD, reorder, share / restrict, duplicate, publish per lodging, search
    (accent-insensitive, server-side), `regenerate-qr`, `qr-poster.pdf` (pdfkit + `qrcode`).
43. Guest endpoints: `GET /booklet`, `/booklet/pages/:slug`, `/booklet/search`.
44. Tests: `guest-app-booklet.unit.test.js` (rules 16, 17, 19, 20), `guest-app-block-validation.unit.test.js`
    (sanitising), `guest-app-media.unit.test.js`, `guest-app-qr.unit.test.js` (regenerate kills the old
    code).

---

## Slice F — Guest PWA (`apps/guest`, spec §6)

45. Scaffold `apps/guest` (Vite + React + MUI + React Router, same versions as `client/`), theme
    `src/theme.js` with the §6.1 tokens (day / night), Marcellus + Karla woff2 copied from the site's
    files into `public/fonts/` (§9: the operator provides them), `lucide-react` icons.
46. Shell: `TabBar` / `NavRail` driven by `/lodging` modules, night register (`isNight` from `/me` +
    `prefers-color-scheme` + manual switch), FR / EN `i18n`.
47. Components of §6.4, one file each, JSDoc header; screens of §6.6; every amount and label rendered
    from the server payload (no price arithmetic in the app — cart total = last quote).
48. Service worker: precache shell + fonts, runtime cache of the resolved booklet and its images
    (stale-while-revalidate), never caches `/orders`, `/shop`, `/gate`; offline banner.
49. Install prompt rule 52; manifest served by `GET /public/v1/guest/manifest.webmanifest`.
50. Serving: `guest-app` serves the built `apps/guest/dist` on the guest host (host-based mount in the
    plugin, SPA fallback, `Cache-Control` immutable on hashed assets, CSP allowing only self).
    `scripts/build-plugin-packages.mjs` gains the extra-assets step for this plugin.
51. Client tests (Vitest, one file per subject): `HomePage.modules.test.jsx`, `ShopPage.free-states.test.jsx`,
    `SlotGrid.states.test.jsx`, `CartPage.payment-choice.test.jsx`, `NameConfirmSheet.test.jsx`,
    `BlockRenderer.blocks.test.jsx`, `AppShell.night.test.jsx`.
52. UI verification (CLAUDE.md §9): `npm run dev` + the guest app dev server, happy path + edge cases of
    spec §7 at 390 / 900 / 1280 px, day and night, EN; screenshots attached to the PR.

---

## Slice G — Studio (`apps/studio`)

53. Scaffold `apps/studio` with GuestFlow's `client/src/theme.js` and shared components imported from
    `client/src/components` (alias), session auth via the existing admin cookie; served at `/studio` by the
    plugin while active, admin role only.
54. Screens: lodging switcher, *Modules & infos* (drag order, wifi, contacts, hero, enable lodging, QR
    regenerate + poster), *Livret* (pages per lodging, share / restrict / duplicate, block palette,
    FR / EN side by side, publish), *Boutique* (item presentation, category order), *Horaires du service*,
    *Médiathèque*. `PageActionBar` on each page (spec §6.6).
55. `PhonePreview` imports the real `apps/guest` renderers (workspace alias) so the preview cannot drift.
56. Client tests: `ModulesPage.test.jsx`, `PageEditor.blocks.test.jsx`, `ServiceHoursPage.test.jsx`.
57. UI verification at tablet (primary target) and desktop; mobile usable (read and toggle).

---

## Slice H — Hardening and rollout

58. E2E Playwright `e2e/guest-app.spec.js`: QR → home → order (note) → push recorded → line on the fiche →
    SAS departure collects it; card path against the Qonto sandbox stub; offline booklet.
59. Accessibility pass: axe on every guest screen in both registers (0 serious), keyboard path through the
    order, text at 200 %.
60. Bundle budget: guest app first load ≤ 200 KB gzip (fonts excluded), enforced by
    `scripts/check-bundle-budget.mjs`.
61. Security review (`/security-review`): session cookie, lookup throttling, name lock, no data of another
    stay, rich-text sanitising, upload limits, guest host CSP.
62. Production: DNS + Caddy route for the guest host (operator), plugin installed and configured, lodgings
    enabled, QR posters printed, catalogue flagged, service hours set, photos uploaded.
63. Docs: `changelog.d/added--guest-app.md` (+ `migration--guest-app-tables.md`), README headline
    feature, spec status → `Implemented`, §10 progress, test counts updated in spec §7.
64. Release through `/guestflow-release` once every slice is merged and the user asks for it.

---

## Slice I — Booklet content (decided 2026-11-05)

65. The user sends the complete welcome booklets of La Granja and L'Estiva; their pages, blocks and photos are
    entered through the studio API (shared pages where both say the same thing), FR first, EN after.
66. Until then the seeded pages are neutral placeholders, marked as such in the studio.

---

## Risks and how the plan handles them

| Risk | Mitigation |
|---|---|
| Money path wrong (double billing, lost payment) | Core commit in one transaction, exhaustive unit tests (D1, D3), late-payment conflict state, E2E with the SAS departure (H58). |
| Bath double-booked between a guest and the operator | Single scheduler provider + holds visible to every consumer (C1), re-validation at order time (`SLOT_TAKEN`). |
| Guest app drifts from GuestFlow prices | No price arithmetic client-side; quote = the fiche's engine; projection shared with the website (B2). |
| Cross-plugin coupling | SDK hooks (`resourceScheduler`, `resourceHolds`) and core modules, never `require` of another plugin. |
| Guest host misconfigured | Plugin setting validated, integration card shows the host status; the app stays reachable on the admin host path as fallback during setup. |
| Scope creep | Spec §8 is the fence; anything else becomes a new spec. |
