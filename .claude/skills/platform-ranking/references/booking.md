# Booking.com — ranking

Facts read on the Partner Hub on **2026-10-07**, the week Booking announced its updated EEA
ranking information (DMA compliance email, Annex 4 « Classement » of the General Delivery Terms
"later this year"). Sources are listed at the bottom. Re-read them when Booking announces a change.

## Our listings

| Listing | Booking `hotel_id` | Public slug |
|---|---|---|
| La Granja (gîte) | **14407976** | `gite-a-la-ferme-domaine-solio` |
| L'Estiva (tent) | **15343212** | `tente-domaine-solio` |

- Both are fed by **Lodgify** (rates and availability), so we are a **connected partner**. Some deals
  are unavailable for that reason (see below). The Lodgify exit (`lodgify-decommission`) will change
  this, so re-check the deal list after the switch.
- Commission is about **15 %**, plus about 1.4 % payment fees (measured on payouts,
  `platform-booking-intake/references/booking.md`). Lodgify adds **+7.5 %** to the Booking price.
- **Property is in France, so EEA, so no-parity.** Prices elsewhere are ignored for ranking and for
  every programme's eligibility.

## What the ranking uses (official)

Search results are personalised. Several algorithms predict how likely a property is to be booked
for this search. **The weights are not fixed**: they are set per search. Booking's four groups:

1. **Property characteristics** — location, **prices offered on Booking.com**, guest review score,
   **quality of the property page**, other stay-related features.
2. **Performance on Booking.com** — **conversion rate** (bookings ÷ property page visits) and
   **click-through rate** (search result → property page).
3. **The traveller's search** — destination, dates, **length of stay**, number and type of guests.
4. **The traveller's preferences** — search history (unless opted out), country, language.

Booking's own list of ways to improve visibility: a high-quality property page, competitive prices
**on Booking**, strong review scores, better conversion and click-through, and the programmes
**Genius, Deals, Preferred, Preferred Plus, Visibility Booster**.

**Not used:** prices, availability or conditions on any other channel (EEA, no-parity). The extranet's
« Analyse » scan of other sites' prices is shown for information only and has no effect.

## The levers, cheapest first

The factors above are Booking's words. The levers below apply them to our two listings: where a
bullet is our deduction rather than a Booking statement, it says so or follows directly from a
factor above.

### 1. Being in the results at all

The search matches dates, length of stay and party size before ranking anything. If a listing does
not match a search, it is not ranked lower. It does not appear at all.

- **Minimum stay.** It must be 2 nights and no more, except on the recipe's dated 3-night bridge
  blocks. See « Contrôle obligatoire … le minimum de séjour » in
  `platform-tariff-rollout/references/platforms.md`. Two-night stays make up a large share of our
  real demand.
- **Booking window.** Check how far ahead each listing can be booked, and confirm the next season
  is open on the public page.
- **Occupancy.** The maximum guests on Booking must equal the recipe's, or larger parties never see
  the listing.
- **Calendar sync.** Never cancel a guest yourself. Booking counts host-initiated cancellations
  against the listing, and an iCal double booking ends in exactly that. The anti-overbooking sync
  (`specs/db-hygiene-quick-wins.md` §1.1) is a ranking issue too.

### 2. The property page (feeds click-through and conversion)

- Photos (deduction): the first one is what the results list shows, so it carries the
  click-through. Show the lodging, not the landscape.
- Every amenity we really have, ticked (the plancha, the nordic bath, linen, parking). A traveller
  who filters on a facility never sees a listing where it is unticked (deduction).
- Policies that match the product: check-in and check-out times, pets, children's ages.
- The title, as Booking allows it (no punctuation, see `platforms.md`). **Booking writes the
  description itself** and does not let us edit it. Only the facts it is built from can change.
- The title and content are not pushed by Lodgify, so edit them in the extranet.

### 3. The review score

- The score is out of 10, based on the **last 3 years**, and **weighted by recency since January
  2025**: the newest review counts most. One bad stay hurts quickly, and one good one repairs
  quickly.
- Only the **overall** score counts. Sub-scores (cleanliness, comfort, location…) are shown but
  are not averaged into it.
- Guests have **90 days** after check-out to leave a review. Booking emails them itself.
- Booking's levers: a page that matches reality, comfort and cleanliness, attentive service, and a
  generous breakfast if one is offered. Our pre-arrival and on-site emails are the main tool here
  (tone: `guest-email-tone`).
- The score thresholds below gate every programme. Read the current score and review count of
  each listing before proposing one.

### 4. The paid programmes

| Programme | Eligibility (EEA) | Cost to us | Booking's announced effect (average) | Leaving |
|---|---|---|---|---|
| **Genius** | ≥ 3 reviews **and** score ≥ 7.5 | **10 % discount** we fund, on the cheapest / most popular unit (each of our listings is one unit, so the whole listing). Optional higher levels: 15 %, 20 %, value-adds | +30 % search views, +45 % bookings, +40 % revenue net of discount | Any time. Rejoining may take **6 months**. Discount can be suspended 30 days/year (more at levels 2–3) |
| **Preferred Partner** | Performance score ≥ 70 % **and** score ≥ 7 | **Extra commission** (shown in the extranet before joining), plus a badge | +65 % search views, +20 % bookings | Any time. **180 days** before rejoining if we left after an ineligibility notice. Checked every 90 days |
| **Preferred Plus** | Already Preferred, performance score ≥ 80 % and score ≥ 8 (top 10 % of Preferred) | More commission on top | +30 % bookings vs Preferred | Same as Preferred |
| **Visibility Booster** | — | Extra commission **on the dates we pick**, optionally for travellers from chosen countries | Ranking lift on those dates only | Per period |
| **Booking Sponsored Benefit** | Booking decides. External prices no longer count (since Sept. 2026) | None: Booking funds a discount, we get our full rate | — | — |

- **Performance score** (Preferred) combines "the maximum commission your property can generate"
  with the demand for our property type compared to similar properties already in the programme.
  It is computed by Booking, so read it in the extranet. It cannot be derived.
- **Genius stacks.** It combines with other promotions, up to **three discounts**, with only the
  highest discount of each category applying. Our length-of-stay ladder is built from **derived
  rate plans**, not promotions (`platforms.md`, « Les plans tarifaires dérivés »). Whether Genius
  applies on top of a derived plan's price **has not been measured**. Quote a 7-night stay signed in
  as a Genius member before costing it: −42 % then −10 % could put a long stay well below the
  recipe floor.
- **Genius is visible signed-out in EMEA**, so the 10 % is in front of almost every French
  traveller. In practice it is a price cut, not a members' perk.
- Booking's averages compare joiners with non-joiners. Treat them as an upper bound, not a
  forecast.
- Where to find them: Extranet → **Boost performance** → Genius partner program / Preferred
  Partner Program / Visibility Booster.

### 5. Deals (Promotions menu)

Basic Deal, Last-minute, Early Booker, Early Year, Getaway (March–September stays), Late Escape
(≥ 15 %), Black Friday, Country rates, **Mobile rates** (≥ 10 % for mobile bookers), **New Property
Deal** (20 %, ends after 3 bookings or 90 days; only for a listing without reviews, so worth it on
a new listing).

- **Limited-time Deal** is the one deal Booking says "temporarily improves your visibility through
  a higher ranking". It is **not available to connected partners**, and neither are **Secret Deals**
  (members only). That is true for us as long as Lodgify connects the listings.
- A deal's discount applies on top of the price that already carries the Lodgify +7.5 % markup.
  Cost it against the recipe's net target, not against the displayed price.
- How to enter a deal in the extranet (ISO end date, open the date picker first, and the other
  traps): `platforms.md`, « Recréer la dégressivité dans l'extranet Booking ».

## Measuring

- **Analytics → Your search ranking and booking performance**: the ranking factors Booking picked
  for us, plus the search → page view → booking funnel. Read it before any change, then 30 days and
  90 days after.
- **Your Genius report** (once in Genius): bookings, room nights, revenue, cancellation rate, length
  of stay and booking window of Genius guests.
- Record every reading below, with its date.

## Readings

None yet. The first audit should record each listing's review score and count, its funnel numbers,
and which programmes it is in or eligible for.

## Sources (read 2026-10-07)

- Partner Hub, « Search results, ranking, and visibility » —
  `partner.booking.com/en-us/help/growing-your-business/analytics-reports/search-results-ranking-and-visibility`
- « All you need to know about the Preferred Partner Program », « Understanding Preferred Plus »,
  « Understanding the Genius marketing program », « All you need to know about the Visibility
  Booster » — under `partner.booking.com/en-us/help/growing-your-business/`
- « Everything you need to know about guest review scores » —
  `partner.booking.com/en-us/help/property-guest-experience/reviews/`
- « Setting deals or promotions » — `partner.booking.com/en-us/help/rates-availability/rates-special-offers/`
- European Commission DMA factsheet on Booking.com pricing freedom (2026-09-28) —
  `digital-markets-act.ec.europa.eu`

`WebFetch` gets a 403 from the Partner Hub. `curl` with a desktop browser user agent works.
