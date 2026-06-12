# J-1 reminder — beds-made message for linen-by-default properties + option rename

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/j1-linen-default-message` _(user-managed)_ |
| **Created** | 2026-06-12 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The J-1 arrival reminder (`arrival_reminder_1d`, spec `j1-arrival-reminder-email.md`) lists the booked
options and, when no bed-linen option is on the reservation, reminds the guest to bring their own linen.

For properties that **provide bed linen by default** (the property has « Linge de lit » configured as a
default-offered option — `property_option_defaults.offered = 1`, spec `weekly-bed-linen-tracking.md`
§3.7), this reads wrong: the linen is included, the beds are made on arrival, and « Linge de lit »
showing up in « Options réservées » is confusing (the guest didn't choose it).

Separately, some servers carry the option titled « Linge de lits » (plural); it should be the singular
« Linge de lit » everywhere.

## 2. Goal

On the J-1 reminder, properties that include bed linen by default get a warm "your beds will be made on
arrival" line, and « Linge de lit » is dropped from the options list (which is hidden entirely if it
becomes empty). The bed-linen option is named « Linge de lit » (singular) on every server.

## 3. Functional rules

1. **Trigger — property config:** a property "provides linen by default" iff it has the bed-linen option
   (`autoOptionType='bed_linen'`) in its default options with `offered=1`
   (`property_option_defaults`). This is independent of what's on the reservation.
2. When the reservation's property provides linen by default → the J-1 email shows a warm line:
   *« Pour votre confort, les lits seront faits à votre arrivée. »* (flag `bedLinenProvidedByDefault`).
3. In that case, the **« Linge de lit » option is removed** from the J-1 options list (new
   `{{reservedOptionsList}}` = booked options minus the bed-linen option when provided by default).
4. If the resulting options list is **empty**, the whole « Option(s) réservée(s) » line is **not shown**
   (`{{#if hasReservedOptions}}`).
5. The J-1 list label is renamed **« Options réservées » → « Option(s) réservée(s) »**.
6. The "bring your own linen" line shows **only** when linen is neither provided by default **nor** on
   the reservation (flag `bedLinenBringYourOwn = !hasBedLinenOption && !bedLinenProvidedByDefault`) — so
   it never contradicts the "beds made" line.
7. **Option rename (all servers, prod + dev):** the bed-linen option title « Linge de lits » is
   normalised to « Linge de lit » at boot (idempotent), scoped to the `autoOptionType='bed_linen'` row.
8. All detection/shaping is server-side; the template stays declarative (tokens + flags only).

**Edge cases:**
- Property provides linen by default but the operator removed the linen option from the reservation →
  "beds made" line still shows (property-level intent); "bring your own" does **not** show (rule 6); the
  list simply has no linen to remove.
- Linen booked as a **paid add-on** on a property without the default → no "beds made" line, « Linge de
  lit » stays listed (it was a real chosen option), no "bring your own" line.
- Other J-7 / templates using `{{optionsList}}` are **unchanged** (this adds a separate
  `{{reservedOptionsList}}` token; `optionsList` keeps listing every option).

---

## 4. Architecture

> **Fat backend, thin frontend.** The property-default detection, the filtered list, and the flags are
> computed server-side. No client logic.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `controllers/` | `controllers/emailsController.js` | T | `loadReservationGraph` computes `bedLinenProvidedByDefault` for the reservation's property (query `property_option_defaults` × `options` for `bed_linen`, `offered=1`); passes it into every `buildContext` (preview/acknowledge). |
| `utils/` | `utils/emailContextBuilder.js` | T | Accept `bedLinenProvidedByDefault` input; expose `vars.reservedOptionsList` (options minus the bed-linen option when provided by default), `flags.hasReservedOptions`, `flags.bedLinenProvidedByDefault`, `flags.bedLinenBringYourOwn`. |
| `utils/` | `utils/emailAutoSendRunner.js` | T | Compute the same property flag per reservation; pass to `buildContext` (cron parity). |
| `utils/` | `utils/defaultEmailTemplatesRegistry.js` | T | Update the J-1 default body: rename label, use `{{reservedOptionsList}}`/`hasReservedOptions`, add the "beds made" block, switch the bring-your-own block to `{{#if bedLinenBringYourOwn}}`. |
| `utils/` | `utils/bedLinenSeed.js` | T | Normalise the bed-linen option title to « Linge de lit » (singular) at boot when it's the plural alias. |
| `database.js` | `database.js` | T | Idempotent content migration: update the in-place J-1 template body to the new default **iff** the row still holds the previously-shipped body (never overwrite an operator-edited template). |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `pages/EmailTemplatesPage.js` | T | Add picker chips for the new token/flags (`{{reservedOptionsList}}`, `{{#if hasReservedOptions}}`, `{{#if bedLinenProvidedByDefault}}`, `{{#if bedLinenBringYourOwn}}`). |

**Component reuse declaration:** none created; existing editor reused.

### 4.3 API contract

No new endpoints / no signature changes. The J-1 preview/send render differently for linen-by-default
properties.

---

## 5. Data model

- No schema change. Reads the existing `property_option_defaults(propertyId, optionId, offered)`.
- **Data normalisation (idempotent, boot):** `UPDATE options SET title='Linge de lit'` for the
  `autoOptionType='bed_linen'` row whose title is « Linge de lits » (case-insensitive). No row loss.
- **Content migration (idempotent, boot):** the seeded J-1 template body is updated in place only when it
  still equals the previously-shipped body (operator edits preserved).

## 6. UI / UX

The J-1 email body (default), linen-by-default property example:

```
Votre séjour :
- Logement : {{propertyName}}
- Arrivée  : le {{startDate}} à partir de {{checkInTime}}
- Départ   : le {{endDate}} avant {{checkOutTime}}
{{#if hasReservedOptions}}- Option(s) réservée(s) : {{reservedOptionsList}}
{{/if}}{{#if hasResources}}- Équipements réservés : {{resourcesList}}
{{/if}}
{{#if bedLinenProvidedByDefault}}Pour votre confort, les lits seront faits à votre arrivée.

{{/if}}{{#if bedLinenBringYourOwn}}Le linge de lit n'est pas inclus dans votre réservation : pensez à apporter le vôtre …

{{/if}}…
```

- No layout change; pure email copy. Editor gains 4 picker chips.

## 7. Test plan

### Server unit tests
- [x] `email-context-builder.unit.test.js` (+4): `bedLinenProvidedByDefault` drives `reservedOptionsList`
  (linen removed) + flag; `hasReservedOptions` false when the filtered list is empty; `bedLinenBringYourOwn`
  true only when no linen + not provided-by-default; `optionsList` itself unchanged (still lists linen).
- [x] `email-template-renderer.unit.test.js` (+2, J-1 cases updated): body renders the "beds made" line +
  no linen in the list + no "bring your own" when provided by default; "bring your own" when no linen at
  all; lists linen + no messages when linen is a paid add-on; options line hidden when empty.
- [x] `bed-linen-seed.unit.test.js` (+2) + `seeds-en-translation.unit.test.js`: the « Linge de lits »
  plural title is normalised to « Linge de lit » (idempotent).
- [x] Full server suite 1452 green; content migration verified on a copy of the production DB.

### Manual UI verification
- [ ] Preview J-1 for a reservation in a linen-by-default property → "beds made" line, no « Linge de lit »
  in the options, line hidden if that was the only option.
- [ ] Preview for a property without default linen + no linen option → "bring your own" line.
- [ ] Regression: J-7 still lists every option (incl. linen) via `{{optionsList}}`.
- [ ] The option is titled « Linge de lit » in Paramètres → Options.

## 8. Out of scope

- Changing J-7 or other templates' option list.
- Per-reservation (offered flag) detection of included linen — trigger is the **property** config.
- Renaming the English title (« Bed linen » unchanged).

## 9. Open questions

Resolved during scoping (2026-06-12):
- **How to detect linen-by-default?** → Property config (`property_option_defaults`, `offered=1` for the
  bed-linen option), independent of the reservation.
- **Label rename** → « Options réservées » → « Option(s) réservée(s) ».
- **Option title** → « Linge de lits » → « Linge de lit » on every server.
