# Solio booking drawer — the two-screen funnel around the GuestFlow widget

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/booking-tunnel` |
| **Created** | 2026-09-23 (retro-spec of the 2026-09 refonte + the fixes of that day) |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

On `domainesolio.com`, the `guestflow/booking` block is not rendered inline in the lodging page. A
mu-plugin of the Solio site, `gf-seo-reservation.php`, **moves** its blocks into a right-hand drawer
opened by a floating « Réserver dès X €/nuit » button, and splits them across two horizontally
scrolling screens:

1. **Votre séjour** — calendar, dates, travellers, options, cancellation insurance.
2. **Récapitulatif** — the priced summary, the contact fields, the CGV checkbox.

The blocks are **moved, never copied or rebuilt**: the engine's event handlers and internal state stay
intact, which is what lets a visitor go back to the dates and find the options they had ticked.

This file did not have a spec. It gets one now because a live test on 2026-09-23 surfaced four defects
in it, and the rules that explain its shape were only in the code.

## 2. Goal

A funnel where the visitor is never stuck and never guesses: the next button does one thing, a greyed
button says why it is greyed, and the engine's own refinements never flicker on screen.

## 3. Functional rules

### The drawer

1. The drawer is **never `display: none`**, only pushed off-screen — the calendar positions itself
   wrongly when it initialises inside a hidden box. It carries `inert` while closed, to stay out of the
   keyboard path.
2. Arriving with `#reserver` (from another page, or from the banner on the page itself) opens the
   drawer, replaces the hash and keeps the page on its hero.
3. Screen 1 carries **no instruction line**. *(2026-09-23: « Dates, voyageurs et options — le total se
   met à jour en direct. » was removed — it described what the visitor was about to see anyway.)*
   Screen 2 keeps its own, which sets an expectation the page cannot show (« nous répondons en direct,
   sans intermédiaire »).

### Navigation — one button, one job

4. **« Suivant » lives at the END of screen 1's content, not in the sticky bar.** Reaching it means
   having scrolled past the options. It does exactly one thing: go to screen 2.
   *(2026-09-23 — this replaces a sticky « Suivant » that first scrolled to the options and only
   advanced on a second press. When the engine rebuilt its rows — a new quote after a party change —
   the scroll target moved and the button kept re-scrolling instead of advancing.)*
5. The sticky bottom bar therefore **belongs to screen 2 only** (« Retour » + the engine's submit
   button). On screen 1 it is hidden rather than left empty.
6. When « Suivant » is disabled, **a line under it says why**, and that reason is the engine's own
   (« Séjour trop court (minimum 2 nuits). », « Ces dates incluent une nuit indisponible. »), read from
   the calendar's error hint rather than invented a second time. With no engine message, the fallback
   is « Choisissez vos dates d'arrivée et de départ dans le calendrier. »
   A `title` attribute does not count: it never appears on a touch screen.
7. « Réserver » on screen 2 mirrors the engine's own submit button, label and disabled state included.
   The CGV checkbox belongs to the engine: it refuses on click and says why (never a greyed button).

### Refinements of the engine's output

8. The drawer re-dresses the engine's rows without touching its state: human labels, yes/no switches
   for « Linge de toilette » and « Ménage » (the stepper is hidden, not replaced — the quantities and
   therefore the prices stay the engine's), the « Animations » group hidden, hour supplements mirrored
   under the time fields, the insurance notice linked.
9. **The refinement runs immediately inside the MutationObserver callback**, not on a deferred timer.
   A callback runs at the end of the current task, before the browser paints: the engine rebuilding its
   rows and the drawer re-dressing them land in the same frame.
   *(2026-09-23 — a 200 ms throttle meant that changing the number of adults showed the bare stepper
   for ~200 ms before the switch came back. Measured, then re-measured at 0 after the fix.)*
   A 200 ms trailing pass is kept as a net for mutations arriving in bursts during a quote.
10. Every refinement is **idempotent and guarded**: it must make no mutation on a second pass, or the
    observer that triggered it would call it forever. This includes the reason line of rule 6 — writing
    an identical `textContent` still counts as a mutation.

## 4. Architecture

> This lives entirely in the WordPress site, not in GuestFlow. No server layer and no client layer of
> the app is touched. The drawer holds **no** business logic: prices, availability, validity and every
> refusal message come from the engine, which gets them from GuestFlow.

### 4.1 Server side (`server/src/`)

None.

### 4.2 WordPress site (`integrations/wordpress/solio-site/mu-plugins/`)

| File | T/C | Responsibility |
|---|---|---|
| `gf-seo-reservation.php` | T | The whole drawer: the `render_block` filter that moves the engine into two screens, the inline CSS, and the inline JS (navigation, refinements, open/close) |

Inside that file:

| Unit | Responsibility |
|---|---|
| `gf_resa_page_concernee()` | True on a page that carries a lodging (reads `gf_seo_current_config`) |
| `render_block` filter | Builds the shell and moves the engine's children into screens 1 and 2 — screen 2 starts at `.gf-summary` |
| `construire()` (JS) | Distributes the blocks, builds screen 1's footer (button + reason), wires the engine's submit button |
| `majNav()` / `raisonSuivant()` (JS) | Rules 4-7: which button is visible, enabled, and what the disabled one says |
| `affiner()` / `affinerOptions()` (JS) | Rules 8-10: re-dressing the engine's rows, immediately |

### 4.3 API contract

None. The drawer makes no network call of its own.

## 5. Data model

No schema change.

## 6. UI / UX

- **Screen 1 footer**: full-width ocre button (`#B87B2A`), 48 px tall, and under it the reason line in
  `#9A6318`, centred, `.88rem` — the colour of the site's links, not an alarm red: a stay that is too
  short is an instruction, not an error.
- **Sticky bar**: hidden on screen 1 (`[hidden]` beats its `display: flex`), shown on screen 2 with
  « Retour » on the left and the submit button on the right.
- **Mobile (≤600 px)**: the drawer takes the full width; the footer button is already full-width at
  every size, so nothing else changes. Verified at 420 px.
- **Reduced motion**: the screen-to-screen transition is disabled, as before.

## 7. Test plan

### Server unit tests

None — no server code in this spec. The engine-side rules it relies on (the refusal message surviving
its re-render) are covered by `specs/wp-booking-widget-redesign.md` rules 19-20.

### Manual UI verification

Run against the live site with the drawer, the engine and the not-yet-deployed API fields substituted
locally (Playwright, 420 px). Done 2026-09-23:

1. Drawer opens with no instruction line, no sticky bar, the next button at the bottom of screen 1,
   disabled, saying « Choisissez vos dates d'arrivée et de départ dans le calendrier. »
2. A 1-night pick on a 2-night minimum: the reason becomes « Séjour trop court (minimum 2 nuits). »,
   under the button **and** under the calendar.
3. A valid stay enables the button; dates read `28/09/2026` / `03/10/2026`.
4. « +1 adulte »: the « Linge de toilette » and « Ménage » rows stay switches at every sample from
   T+0 ms to T+1500 ms — no flicker.
5. **One** press on « Suivant » lands on screen 2; the sticky bar appears with « Retour » and
   « Payer en ligne ».

## 8. Out of scope

- The GuestFlow booking engine itself (`integrations/wordpress/guestflow-booking/`) — its share of the
  same test session is specced in `specs/wp-booking-widget-redesign.md`.
- The other `gf-seo-*` mu-plugins (facts, head, indexation, FAQ…).
- Deploying to the WordPress host: these mu-plugins are copied by hand onto `.23`
  (`integrations/wordpress/solio-site/` is the versioned copy, not a deployment).

## 9. Open questions

None.
