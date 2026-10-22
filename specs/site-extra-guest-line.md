# Site booking — show the extra-guest supplement and keep the guest cap closed

| Field | Value |
|---|---|
| **Status** | Draft |
| **Branch** | `feature/site-extra-guest-line` |
| **Created** | 2026-10-22 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

A property prices `basePriceIncludedGuests` guests in its nightly rate; every guest beyond that pays
the extra-guest supplement (`extraGuestPrice`, per stay or per night, per-season overrides and tiers —
specs/tariff-events-and-extra-guest-tiers/spec.md).

Audit of the public booking path (WordPress plugin `blocks/booking` → `/public/v1/quote` →
`/public/v1/booking-requests`), 2026-10-22:

- **The supplement IS billed.** The public quote runs the same engine as the back-office with the
  platform forced to `direct`, so `calculateReservationQuote` computes `extraGuestSurcharge`
  ([pricing.js:1537](../server/src/utils/pricing.js#L1537)) and folds it into `finalPrice`,
  `totalStayPrice`, the deposit and the balance. The draft devis created by a booking request carries
  it too.
- **The supplement is NOT shown.** `toPublicQuote` exposes `accommodationTotal` (nights only) and
  `extraGuestSurcharge` as a separate number, but the plugin's `drawSummary`
  ([view.js:896](../integrations/wordpress/guestflow-booking/blocks/booking/view.js#L896)) never reads
  the latter. A visitor with 3 guests on a « 2 included » property sees lines that do not add up to
  the total — the gap is the supplement, unexplained. Nothing near the guest steppers says that a
  guest beyond the included count costs extra either.
- **The cap exists, with one hole.** `properties.maxGuests` (adults + teens + children, babies apart —
  specs/property-capacity-single-total.md) caps the plugin steppers and is enforced server-side by
  `checkGuestCapacity` (409 `OVER_CAPACITY`). But `maxGuests = 0` means « not configured » and turns
  the guard off on both sides: the server accepts any count and the plugin lets the steppers climb
  to 99. On the back-office that tolerance is deliberate (a half-configured property must stay
  bookable by the operator); on the public site it lets a visitor request any number of guests.

## 2. Goal

A visitor on the site sees, in the price summary, exactly what the extra guests cost, knows before
picking the count how many guests the base price covers, and can never request more guests than the
property can host.

## 3. Functional rules

**Live pricing in the funnel**

0. The guest count is an input of the live quote: every change of a guest stepper re-quotes the
   stay (debounced, as for dates and options — `scheduleQuote` in `view.js`, already in place) and
   the supplement is computed by the engine from the property's tariff policy (included guests,
   unit price, per-stay / per-night, per-season override, tiers). The plugin never computes it. This
   rule pins existing behaviour; the change is that the result becomes visible (rules 1–4).

**Display of the supplement**

1. The public quote carries a ready-to-render `extraGuests` block built server-side from the engine
   output: `{ count, total, originalTotal, offered }` — `count` = guests beyond the included ones,
   `total` = what is billed, `originalTotal` = value before an « offered » flag. `null` when
   `count = 0` or both totals are 0. Built with the existing `resolveExtraGuestPdfRow`
   (utils/devisHelpers.js) so the site and the devis PDF read the same row.
2. The existing `extraGuestSurcharge` number stays in the payload unchanged (backward-compatible:
   older plugin versions keep working).
3. When `extraGuests` is present, the plugin summary shows one line between « N nuit(s) » and the
   options: « Personne(s) supplémentaire(s) ×N » → `total` (« Offert » when `offered`). The lines of
   the summary then add up to the total (tourist tax included as today).
4. Under the guest steppers, when the property detail says `basePriceIncludedGuests > 0`, the plugin
   shows « Prix de base pour N voyageurs, supplément au-delà ». No amount is printed there: the price
   depends on season and tiers, and the live summary (rule 3) shows the real figure as soon as dates
   are picked.
5. Both strings go through the plugin's i18n (`class-gf-blocks.php` strings + `en_GB.po`):
   EN « Extra guest(s) ×N » / « Base price for N guests, supplement beyond ».

**Guest cap on the public path**

6. The public path never accepts an uncapped occupancy. When `maxGuests = 0` (capacity not
   configured), the public endpoints use `basePriceIncludedGuests` as the cap: the property stays
   bookable on the site, but no extra guest can be added until its capacity is entered (§9 Q1).
   When both are 0, the cap is 2 (the `maxGuests` column default).
7. The plugin reads the effective cap from the property detail (`maxGuests`, now never 0 on the
   public API for a bookable property) and drops its `99` fallback.
8. The back-office keeps today's behaviour (`maxGuests = 0` → guard off, `forceCapacity` escape hatch).

**Edge cases:**
- `basePriceIncludedGuests = 0` → no « included » note (rule 4); the engine bills no supplement (all
  guests are in the base price), `extraGuests` is `null`.
- `maxGuests ≤ basePriceIncludedGuests` → no supplement can ever arise; no note shown (rule 4 only
  when `maxGuests > basePriceIncludedGuests`).
- Babies never count, neither for the supplement nor for `maxGuests` (unchanged).
- Supplement « offered » cannot come from the public path today (`offeredOptionIds` / overrides are
  forbidden there) — rule 3's « Offert » is for parity only.

---

## 4. Architecture

> Fat backend: the line's figures come from the server (`extraGuests`); the plugin only picks a
> translated label and prints the number.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | — | — | (none) |
| `controllers/` | `public/` quote + booking-request controllers | T | Apply the public cap fallback (rule 6) before `checkGuestCapacity` |
| `models/` | — | — | (none) |
| `middleware/` | — | — | (none) |
| `utils/` | `publicProjections.js` | T | `toPublicQuote` adds `extraGuests` via `resolveExtraGuestPdfRow`; `toPublicProperty` exposes the effective cap (rule 7) |
| `utils/` | `capacity.js` | T | `publicGuestCap(property)` — pure helper returning the effective public cap (rule 6) |
| `scheduledTasks.js` | — | — | (none) |
| `database.js` | — | — | (none) |

### 4.2 Client side

GuestFlow `client/` is not touched. The consumer is the WordPress plugin
(`integrations/wordpress/guestflow-booking/`):

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| block | `blocks/booking/view.js` | T | Summary line (rule 3), included-guests note (rule 4), drop the `99` fallback (rule 7) |
| i18n | `includes/class-gf-blocks.php`, `languages/guestflow-booking-en_GB.po/.mo` | T | Two new strings (rule 5) |
| plugin | `guestflow-booking.php` | T | Version bump (minor) |

**Component reuse declaration:** reuses the summary's existing `sline` helper and the stepper `line`
helper; no new component.

### 4.3 API contract

| Method | Endpoint | Change |
|---|---|---|
| POST | `/public/v1/quote` | Adds `extraGuests: { count, total, originalTotal, offered } \| null`. Additive. |
| GET | `/public/v1/properties[/:id]` | `maxGuests` follows rule 6 instead of returning `0`. |
| POST | `/public/v1/booking-requests` | `409 OVER_CAPACITY` also fires against the rule-6 cap. |

`specs/public-api.md` is updated with the same three changes. All additive / tightening on the
`/public/v1` contract — no consumer loses a field (a Y release, not an X).

---

## 5. Data model

No schema change.

## 6. UI / UX

Booking block, guests section (when `basePriceIncludedGuests > 0` and `maxGuests > basePriceIncludedGuests`):

```
Adultes        [-] 3 [+]
Adolescents    [-] 0 [+]
Enfants        [-] 0 [+]
Capacité : 4 voyageurs · 1 bébé
Prix de base pour 2 voyageurs, supplément au-delà
```

Price summary:

```
7 nuit(s)                              840,00 €
Personne(s) supplémentaire(s) ×1        25,00 €
Petit-déjeuner ×2                      168,00 €
Taxe de séjour                          33,00 €
Total                                1 066,00 €
```

**Responsive:** the note and the line use the existing summary/stepper markup, which already wraps
on mobile; no layout change. Checked at 375px, ~900px, ≥1200px.

## 6b. Rollout — production data

Rule 6's fallback is a safety net, not the intended setting: each bookable property must carry its
real `maxGuests`. Set by the operator in the back-office (Logements → fiche → onglet Général →
« Max voyageurs »), **before** installing the release that ships rule 6, so the site never caps a
configured property at its included-guests count:

| Property | `maxGuests` |
|---|---|
| La Granja | 15 |
| L'Estiva | 5 |

No migration writes these values: they are operator data, and a name-keyed UPDATE in `database.js`
would run on every install, including test databases.

## 7. Test plan

### Server unit tests
- [ ] `tests/site-extra-guest-line.unit.test.js` —
  `toPublicQuote` emits `extraGuests` (billed, offered, none) and keeps `extraGuestSurcharge`;
  `publicGuestCap` (configured cap, `0` → included guests, both `0` → 2); booking request over the fallback cap → 409.

### Manual UI verification (WordPress test site or plugin harness)
- [ ] 3 guests on a « 2 included » property: the supplement line appears and the lines add up to the total.
- [ ] 2 guests: no supplement line.
- [ ] Dates picked, then +1 / −1 guest: the summary re-quotes and the line appears / disappears with the right amount.
- [ ] Per-night or tiered supplement in a season with an override: the line matches the back-office devis for the same stay.
- [ ] English page: English labels.
- [ ] Property with `maxGuests = 0`: steppers stop at the rule-6 cap; a forged request beyond it gets 409.
- [ ] Mobile (375px): note and line wrap cleanly.

## 8. Out of scope

- Showing the tier phrase (« 15 € la 1ʳᵉ nuit, puis 8 €/nuit ») on the site — French-only on the
  server today.
- Changing how the supplement is computed.
- Back-office capacity behaviour.

## 9. Open questions

- Q1: On the public site, what cap applies when a property has `maxGuests = 0` (capacity not
  configured)?
  - A (2026-10-22, Adrien): fall back to `basePriceIncludedGuests` — bookable, but no extra guest
    until the capacity is configured (rule 6). Rejected: making the property unbookable on the site;
    keeping it uncapped.
