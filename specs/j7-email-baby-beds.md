# J-7 email — baby-bed notice

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/j7-email-baby-beds` _(user-managed)_ |
| **Created** | 2026-06-08 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The J-7 arrival-reminder email (`arrival_reminder_7d`, spec `email-automation.md`) already lists the
stay details and a bed-linen configuration. It says nothing about baby beds. For bookings with one or
more babies, the guest needs to know whether a baby bed is provided — and, when none is available
(all baby beds are already booked for the dates), to **bring their own**.

## 2. Goal

The J-7 email tells a guest who booked with at least one baby either how many baby beds are provided,
or — when no baby bed is available — that they should bring one.

## 3. Functional rules

1. The notice appears **only** when the reservation has `babies > 0`.
2. If `babies > 0` **and** `babyBeds > 0` → the email states how many baby beds are provided
   (singular/plural): *"Vous voyagez avec un bébé : un lit bébé vous est fourni."* /
   *"Vous voyagez avec des bébés : N lits bébé vous sont fournis."*
3. If `babies > 0` **and** `babyBeds = 0` → the email asks the guest to bring one:
   *"Vous voyagez avec un bébé : nous ne disposons plus de lit bébé disponible pour vos dates. Merci de
   prévoir d'en apporter un."*
4. When `babies = 0`, **no** baby-bed sentence is rendered (no blank artefact).
5. The notice text is **computed server-side** (fat backend) and exposed as a single template variable
   `{{babyBedNotice}}`, gated by a `{{#if hasBabyBedNotice}}` flag — the template stays declarative,
   no business logic in the email body.

**Edge cases:**
- `babyBeds > babies` (a child also using a baby bed) → still "N lits bébé vous sont fournis" (N = babyBeds).
- iCal-imported reservation with babies but unpriced → same rules (driven by stored `babies`/`babyBeds`).

---

## 4. Architecture

> Server-only. No DB change, no API change. The email renderer + J-7 default template consume one new
> variable + one new flag produced by the context builder.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `utils/` | `utils/emailContextBuilder.js` | T | Compute `vars.babyBedNotice` (the sentence per rules 2-3) + `flags.hasBabyBedNotice` (`babies > 0`) from the reservation's `babies` / `babyBeds`. |
| `utils/` | `utils/defaultEmailTemplatesRegistry.js` | T | Add a `{{#if hasBabyBedNotice}}{{babyBedNotice}}{{/if}}` block to the J-7 default body (after the bed-linen block). |
| `utils/` | `utils/emailTemplateRenderer.js` | REUSE | Generic — already resolves any `vars`/`flags`; no change needed. |

### 4.2 Client side

None.

### 4.3 API contract

None (the J-7 email is rendered server-side by the existing email pipeline).

---

## 5. Data model

No change. Uses the existing `reservations.babies` + `reservations.babyBeds` columns.

> **Important — existing templates are NOT auto-updated.** The seed
> (`ensureDefaultEmailTemplates`) only **inserts** missing templates; it never overwrites an
> operator's row (deliberate, `email-automation.md` §5). So:
> - **Fresh installs / a re-seeded (deleted → reboot) J-7** get the baby-bed block automatically.
> - An **existing** J-7 template (the operator's current row) keeps its body. To get the notice, the
>   operator either (a) pastes the snippet below into the J-7 body via Paramètres → Emails, or
>   (b) deletes the J-7 template so it re-seeds with the new default on the next boot.
>
> Snippet to paste (the `{{babyBedNotice}}` variable + `hasBabyBedNotice` flag are now available to
> every template):
> ```
> {{#if hasBabyBedNotice}}{{babyBedNotice}}
>
> {{/if}}
> ```

## 6. UI / UX

No UI. The rendered email gains one sentence (or none) between the bed-linen paragraph and the caution
reminder. French copy per §3.

## 7. Test plan

### Server unit tests
- [x] `tests/email-context-builder.unit.test.js` (+4): no babies → empty notice + flag false; babies +
  1 bed → "un lit bébé vous est fourni"; babies + N beds → plural; babies + 0 bed → "apporter un".
- [x] `tests/email-template-renderer.unit.test.js` (+3, end-to-end): the shipped J-7 body renders the
  provided-bed notice, the bring-one notice, and nothing when no babies.
- [x] `tests/default-email-templates-registry.unit.test.js`: the new `{{babyBedNotice}}` /
  `{{#if hasBabyBedNotice}}` are recognised by the token/flag discipline checks (validated against the
  context builder) — pass unchanged.

### Manual UI verification
- [ ] Preview the J-7 email for a reservation with 1 baby + 1 baby bed → "un lit bébé vous est fourni".
- [ ] Preview for 1 baby + 0 baby bed → "apporter un".
- [ ] Preview for 0 baby → no baby-bed sentence.
  *(pending — needs the running app; and the operator's existing J-7 template must carry the snippet, see §5.)*

## 8. Out of scope

- A "reset template to default" / "sync default body" action (would let existing templates pick up
  default changes without manual edits) — a useful follow-up, but a separate feature; the seed's
  never-overwrite contract is intentional.
- Surfacing the baby-bed notice in any email other than J-7.

## 9. Open questions

(None.)
