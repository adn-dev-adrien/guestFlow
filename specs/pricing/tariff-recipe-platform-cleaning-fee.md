# Tariff recipe — cleaning fee charged by a platform

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/recipe-platform-cleaning-fee` |
| **Created** | 2026-10-26 |
| **Author** | Adrien |
| **Related PR** | [#788](https://github.com/adn-dev-adrien/guestFlow/pull/788) |

---

## 1. Context

Since Airbnb's checkout-chores policy (bookings made from 2026-11-20, see
[airbnb-no-checkout-chores.md](airbnb-no-checkout-chores.md)), an Airbnb guest can no longer be asked to
wash the dishes, strip the beds or take the trash out. The work moves to the host, and on 2026-10-26 its
cost was put into the **Airbnb cleaning fee**, set by hand in the Airbnb console:

| Listing | Ménage (net) | Extra chores | Net to recover | Airbnb fee (15.5 %) | Cleaning fee set |
|---|---|---|---|---|---|
| Gîte | 80 € (not in the nightly price) | 55 min × 25 €/h = 22.92 € | 102.92 € | ÷ 0.845 | **122 €** |
| L'Estiva | — (already in the nightly price) | 25 min × 25 €/h = 10.42 € | 10.42 € | ÷ 0.845 | **13 €** |

A first figure of 108 € for the Gîte forgot that Airbnb's commission is also taken on the cleaning fee;
it netted 91.26 € for a 102.92 € cost. That is exactly the slip a recipe exists to prevent.

Today a tariff recipe (`server/src/recipes/*.json`, [tariff-recipes/spec.md](tariff-recipes/spec.md))
knows nothing about cleaning fees. The « Prix plateformes » grid (`PlatformPriceCard`) shows, per
channel, the nightly price and the extra-guest price to configure — not the cleaning fee. At the next
tariff update, nothing reminds the operator that Airbnb carries one, nor how much it must be.

## 2. Goal

The recipe declares what a ménage costs and which channels bill it as a separate cleaning fee; the
« Prix plateformes » grid shows, per channel, the cleaning fee to configure, commission included.

## 3. Functional rules

### 3.1 Recipe

1. A recipe may carry an optional `cleaning` block:
   ```json
   "cleaning": {
     "netCost": 80,
     "hourlyRate": 25,
     "platformFees": [
       { "platform": "Airbnb", "chargesCleaning": true, "choresMinutes": 55 }
     ]
   }
   ```
   - `netCost` — what one end-of-stay ménage costs the host, in euros, ≥ 0.
   - `hourlyRate` — the cost of an hour of work, in euros, ≥ 0; prices the chores.
   - `platformFees` — one entry per channel that bills a separate cleaning fee.
     - `platform` — the platform name as recorded in Paramètres → Plateformes, matched
       case-insensitively; non-empty; each platform at most once.
     - `chargesCleaning` — `true` when the fee must cover the ménage itself (`netCost`); `false` when
       the ménage is already in the nightly price and the fee only covers the chores.
     - `choresMinutes` — the work the channel forbids asking of the guest, in minutes, ≥ 0.
2. A recipe without `cleaning` behaves exactly as today. A `cleaning` block with an empty or missing
   `platformFees` is valid and produces no cleaning fee anywhere.
3. The loader rejects an invalid block with the field path and the reason, like every other recipe
   field (tariff-recipes rule 27): a negative or non-numeric amount, an empty platform name, a duplicate
   platform, a non-boolean `chargesCleaning`.

### 3.2 Apply

4. Applying a recipe writes its `platformFees` onto the property, on **both** paths — with or without a
   season change — exactly like `welcomePack.cost` (a recipe whose only change is the cleaning block
   produces an empty season diff and must still be written).
5. Each entry is stored with its **net to recover**: `(chargesCleaning ? netCost : 0) +
   choresMinutes / 60 × hourlyRate`, rounded to the cent, plus its two parts for display.
6. An entry whose `platform` matches no row of the `platforms` table blocks the apply with « Plateforme
   inconnue dans la recette : <nom> ». Nothing is written.
   > **Superseded 2026-10-27 by rule 15** — an unknown channel is skipped and named, it no longer blocks.
7. Re-applying a recipe without `cleaning`, or without an entry for a channel, clears that channel's
   stored fee: the recipe owns the value, as it owns `welcomePackCost`.

### 3.3 Grid

8. `GET /api/properties/:id/platform-prices` serves, per platform, `cleaningFee`: the whole-euro
   gross `grossFromNet(net, commissionPercent)` (rounded up, the same function as the nightly prices),
   and `cleaningFeeDetail`: `{ cleaningNet, choresNet, net }`. `null` for a channel without an entry.
9. The commission is the platform's current one, read at request time: changing Airbnb's commission in
   Paramètres → Plateformes moves the displayed fee without re-applying the recipe.
10. The grid shows a « Ménage / séjour » column only when at least one channel has a fee. A channel
    without one shows « — ».

### 3.4 Added after review (2026-10-26)

11. **A cleaning-fee change is a change.** The preview compares the recipe's fees with the stored ones,
    per platform, by net, and serves `cleaningFeeChanges: [{ platform, from, to }]` (`null` = no fee).
    The apply dialog lists them and no longer says « Rien à modifier » when one differs; the apply
    counts them as a change, so it answers `applied: true` and writes its line in the tariff journal
    ([tariff-change-journal.md](tariff-change-journal.md) rule 5) — the guest-facing Airbnb price moved.
12. **No part can silently price at 0 €.** The loader requires `netCost` as soon as one entry has
    `chargesCleaning: true`, and `hourlyRate` as soon as one entry counts `choresMinutes > 0`.
13. **The own channels carry no platform cleaning fee.** An entry naming `direct` or `Lodgify` (the
    Direct row of the grid, rule 10's edge case) blocks the apply with « Le canal direct ne facture pas
    de frais de ménage plateforme : <nom> » — it would be stored and never shown.
14. **The fees go with the recipe** (added at the 2026-10-27 `inte/plugins` sync). Detaching a property
    from its recipe, or purging the `tariff-recipes` plugin's data, empties its `platformCleaningFees`:
    no screen edits them, so a fee left behind would stay in the « Prix plateformes » grid forever. The
    seasons themselves stay, as before.

**Edge cases:**
- `chargesCleaning: false` and `choresMinutes: 0` → net 0 → fee 0 €, shown as « 0 € » (declared, not
  absent).
- A platform renamed after the apply → its stored fee no longer matches and the cell shows « — » until
  the recipe is re-applied with the new name.
- The Direct row never shows a cleaning fee: the ménage there is a GuestFlow option, priced by the
  engine.

### 3.5 Fixed at the 2026-10-27 spec review

15. **An unknown channel is skipped, not blocking** (supersedes rule 6). A fresh install records only
    `direct` in `platforms`, so both shipped recipes refused to apply (« Plateforme inconnue dans la
    recette : Airbnb »): a generic product failed on its own recipes. The fee of a channel the
    installation does not record is now left out, the rest of the recipe applies, and the preview names
    it: « Plateforme inconnue dans la recette : <nom> — frais de ménage non appliqués. Ajouter la
    plateforme dans Paramètres › Plateformes puis réappliquer. » Re-applying once the channel exists
    picks the fee up as a change (rule 11).

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

On `inte/plugins` the recipe engine is the `tariff-recipes` plugin: its files live under
`plugins/tariff-recipes/` (moved there at the 2026-10-27 sync). The stored column and the « Prix
plateformes » grid stay in the core, inert without a recipe (an empty list, no column).

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `plugins/tariff-recipes/` | `store.js` | T | Validates the `cleaning` block (rules 1–3). |
| `plugins/tariff-recipes/` | `platformCleaningFee.js` | C | Pure: net to recover per entry (rule 5); stored-vs-desired diff (rule 11). |
| `plugins/tariff-recipes/` | `controller.js`, `index.js` | T | Detach and purge empty the stored fees (rule 14). |
| `plugins/tariff-recipes/` | `model.js` | T | Apply: resolves platforms, blocks on unknown or own channel (rules 6, 13), diffs stored fees and counts them as a change (rule 11), writes on both paths (rules 4, 7). |
| `plugins/tariff-recipes/` | `model.js` | T | 2026-10-27 (rule 15) — an unknown channel is skipped with a non-blocking warning; rule 6's block is gone. |
| `models/` | `propertiesModel.js` | T | `setPlatformCleaningFees`; `platformPrices` serves `cleaningFee` + detail (rules 8–9). |
| `database.js` | `database.js` | T | Idempotent `properties.platformCleaningFees TEXT DEFAULT '[]'`. |
| `plugins/tariff-recipes/recipes/` | `gite-2027.json` | T | 3.6.0 — `cleaning` { 80, 25, Airbnb charges cleaning, 55 min }. |
| `plugins/tariff-recipes/recipes/` | `aventura-lodge-2026.json` | T | 1.2.0 — `cleaning` { 30, 25, Airbnb chores only, 25 min }. |
| `plugins/tariff-recipes/tests/` | `tariff-recipe-platform-cleaning-fee.unit.test.js` | C | Rules 1–9, including 122 € and 13 €. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `PlatformPriceCard.jsx` | T | « Ménage / séjour » column with the detail in a tooltip (rule 10). |
| `plugins/tariff-recipes/` | `TariffRecipeCard.jsx` | T | Apply dialog lists `cleaningFeeChanges`, « Rien à modifier » only when there are none (rule 11). |
| `plugins/tariff-recipes/__tests__/` | `TariffRecipeCard.cleaning-fee.test.jsx` | C | Rule 11 in the dialog. |
| `components/__tests__/` | `PlatformPriceCard.cleaning-fee.test.jsx` | C | Column shown / hidden, « — » cell. |

**Component reuse declaration:** consumes the existing `PlatformPriceCard`, `TableCard`, MUI `Tooltip`.
Nothing created.

### 4.3 API contract

| Method | Endpoint | Response change |
|---|---|---|
| GET | `/api/properties/:id/platform-prices` | Each `platforms[]` item gains `cleaningFee: number \| null` and `cleaningFeeDetail: { cleaningNet, choresNet, net } \| null`. Additive. |
| GET | recipe preview (unchanged route) | Gains `cleaningFees` and `cleaningFeeChanges` (rule 11). |
| POST | recipe apply (unchanged route) | May answer the new blocking errors of rules 6 and 13. |

### 4.4 Skills and docs

| File | Change |
|---|---|
| `.claude/skills/tariff-recipe/SKILL.md` | Documents the `cleaning` block next to `welcomePack`. |

---

## 5. Data model

| Table | Column | Type | Default | Purpose |
|---|---|---|---|---|
| `properties` | `platformCleaningFees` | TEXT (JSON) | `'[]'` | `[{ platform, cleaningNet, choresNet, net }]`, written by the recipe apply only. |

**Data impact:** none on existing rows — `'[]'` reproduces today's grid. The value appears at the next
apply of a recipe carrying a `cleaning` block.

## 6. UI / UX

Property tarif page, « Prix plateformes » card: a last column « Ménage / séjour », right-aligned,
after « Personne supp. ». Each value reads « 122 € » with « net 102,92 € » beneath it (same pattern as
the season headers, never wrapped), and hovering — or tapping on mobile — shows its make-up:
« Ménage 80,00 € + corvées 22,92 € = 102,92 € net ». A channel without a fee shows « — ». The column is
absent when no channel has one.

Responsive: the grid already sits in `TableCard` with a horizontal scroll inside the card on `xs`; the
extra column scrolls with the others, the page itself never scrolls sideways. No `PageActionBar`
change (the card has no action).

## 7. Test plan

### Server unit tests — `tariff-recipe-platform-cleaning-fee.unit.test.js` (14 tests; 2 added for rule 14 on 2026-10-27)

- 2026-10-27 spec review (rule 15): the rule-6 case now asserts skip + warning;
  `tariff-recipe-fresh-install.unit.test.js` (3) applies both shipped recipes on a `direct`-only install.
- [x] Validation: valid block, shipped recipes, missing block, each invalid field (rules 1–3).
- [x] Net: Gîte 102.92, Estiva 10.42 (rule 5).
- [x] Grid: Airbnb 15.5 % → 122 € and 13 €; commission change moves the fee (rules 8–9).
- [x] Apply: written with an empty season diff; unknown platform blocks; absent block clears (4, 6, 7).
- [x] Cleaning-only change reported, applied, journaled; required parts; own channel blocked (11–13).

Eight existing suites build their own `properties` table: they gain the `platformCleaningFees` column,
and the three that apply a shipped recipe gain a `platforms` table with Airbnb.

### Client unit tests
- [x] `PlatformPriceCard.cleaning-fee.test.jsx` (2) — column present with a fee (value, net, make-up), absent without; « — » for a channel without one.
- [x] `TariffRecipeCard.cleaning-fee.test.jsx` (2) — rule 11 in the apply dialog.

Full suites on 2026-10-26: server 4 988/4 988, client 1 482/1 482, E2E 89 passed (1 skipped).

### Manual UI verification
- [x] Gîte 3.6.0 and Lodge 1.2.0 applied on a dev copy → Airbnb 122 € (net 102,92 €) and 13 €, the
  other channels « — ».
- [x] Mobile (390px): the grid scrolls inside its card, no page scroll (scrollWidth 375).
- Noted, not fixed (pre-existing, out of scope): four-digit season prices (« 1135 € ») wrap in the
  season columns at desktop width.

## 8. Out of scope

- Pushing the fee to Airbnb: prices are still typed into each extranet (lodgify-decommission decision).
- Charging the cleaning fee on a GuestFlow reservation: the Airbnb intake already records it from the
  booking mail.
- Short-stay cleaning fee variants (Airbnb « montant pour les séjours courte durée »).

## 9. Open questions

- Q: Where does the ménage cost go in the recipe — one net per channel, or ménage + chores?
  - A (2026-10-26, Adrien): **ménage net cost + chores per channel**, so the detail survives.
- Q: Gîte cleaning fee — 108 € or fully grossed up?
  - A (2026-10-26, Adrien): **122 €**, set in the Airbnb console the same day.
