---
name: platform-ranking
description: Audit and improve how high a GuestFlow listing ranks in an OTA's search results (Booking.com today, other platforms later) — what the platform actually ranks on, which levers the operator controls, what each paid visibility programme (Genius, Preferred, Visibility Booster, deals) really costs against the tariff recipe, and how to measure the effect. Use when the operator asks how to rank higher, why a listing gets few views or bookings, whether to join a platform programme, or after a platform email about ranking or programmes.
---

# Ranking higher on a platform

An OTA ranks a listing by **how likely it is to be booked for this particular search**. The
platform estimates that likelihood from the listing, from how it has performed so far, and from the
traveller's search. So there is no secret to find. Ranking comes from levers, each with a price, and
the job is to pull the cheap ones first and to cost the paid ones before anyone says yes.

Per-platform facts (official factors, programme thresholds, extranet paths, our listings' ids)
live in `references/<platform>.md`. Read the one for the platform first. **Only write a fact there
when the platform itself states it**, and give the source and date. Advice from
channel-manager blogs is a hypothesis to test, never a rule.

## Ground rules

- **The operator logs in to the extranet themself.** Never type, store or log platform credentials.
  On Booking, move only by clicking: a typed URL ends the session (see
  `platform-tariff-rollout/references/platforms.md`, « Piloter l'extranet Booking »).
- **Visibility is bought with margin.** Every paid lever lowers the net: a discount (Genius, deals)
  or extra commission (Preferred, Visibility Booster). Before proposing one, compute the net it
  leaves per stay **with the repo's own code** and compare it to the recipe's net target (the
  recipe-reading snippet is in `platform-tariff-rollout` step 1). A programme that drops a night
  below the target is a pricing decision, not a ranking tweak.
- **Joining, leaving or changing a programme is the operator's decision.** Present the options with
  their net cost through `AskUserQuestion`, and never activate one on your own. Several programmes
  impose a waiting period before you can rejoin, so leaving one is not freely reversible.
- **Discounts stack.** On Booking, Genius combines with up to two other promotions. Check what the
  guest really pays by quoting the public page with the full set of discounts active, as
  `platform-tariff-rollout` does. The extranet's own preview is not proof.
- **The other channels are not a ranking input in the EEA.** Booking ranks without looking at our
  direct or other-platform prices (we are a no-parity property). A lower direct price costs
  no Booking visibility, so never raise the direct price to "protect" a platform ranking.

## The audit

1. **Read the platform's own diagnosis first.** On Booking, Analytics → « Your search ranking and
   booking performance » shows the ranking factors it picked for us, plus the funnel: search views
   → page views (click-through) → bookings (conversion). Write down the numbers and the date. They
   are the baseline any change is judged against.
2. **Work through every lever in the reference's checklist**, cheapest first. They fall into four
   groups: things that make us invisible for a search (minimum stay, booking window, closed dates),
   the page itself (photos, amenities, policies), the guest experience (review score), and the paid
   programmes. Note the current state of each one. Do not decide yet.
3. **Cost each paid programme** we are eligible for: the net per stay under it and the gap to the
   recipe target, on the same comparable cases the tariff rollout uses.
4. **Hand the operator a self-contained HTML summary.** It covers the baseline, the levers found off
   or weak, the free fixes, and each paid option with its cost. Publish it with the `Artifact` tool,
   then put the open decisions to the operator through `AskUserQuestion`.
5. **Apply only what was approved**, then record in the reference what changed and when.
6. **Measure, don't assume.** Re-read the same dashboard 30 days later, and 90 days later for a
   programme. Compare it to the baseline from step 1. The platform's announced uplift ("+45 %
   bookings") is an average over every property, not a forecast for ours. Record the measured
   effect in the reference, with dates.
