# J-2 email — coffee-machine line + SAS-style arrival-complement detail

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/j2-email-coffee-and-sas-complement` |
| **Created** | 2026-07-16 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The « Rappel arrivée — J-2 » email (registry `stableKey: arrival_reminder_1d`, `dayOffset: -2`) is the
pre-arrival reminder. Two gaps:

1. **No coffee-machine info.** Guests don't know the property's coffee machine is a **capsule machine
   (Nespresso type)**, so they can't bring the right capsules. Nothing in the email/property data
   mentions it today.
2. **The arrival-complement detail is a terse inline sentence.** The J-2 email already surfaces the
   complement to collect on arrival (`{{complementNotice}}`, fed by the same source of truth as the SAS —
   `reservationsModel.buildArrivalComplementDetail`), but as a one-line sentence:
   *« Un complément de 11,96 € sera à régler… Il comprend : Taxe de séjour (11,96 €). »*
   The **SAS check-in recap** shows a proper itemised list — *« label : qté × prix = total »* per line +
   a **Total** — which is what Adrien wants in the email too. Two defects in the current inline path:
   - no per-line **qty × unit price** (only `label (total)`),
   - the **English** email still prints the French label **« Taxe de séjour »** (should be
     « Tourist tax ») because the SAS-detail path uses the server label verbatim.

Current J-2 render (FR): the complement line reads
`Un complément de 11,96 € sera à régler directement sur place à votre arrivée. Il comprend : Taxe de séjour (11,96 €).`

## 2. Goal

The J-2 email (a) always tells the guest the coffee machine is a capsule machine (Nespresso type), and
(b) when a complement is due on arrival, lists it **like the SAS check-in recap** — one line per item with
`label : qté × prix = total`, a **Total**, and correctly localised FR/EN labels.

## 3. Functional rules

Decisions taken with Adrien on 2026-07-16 (AskUserQuestion):
- **Coffee line = static text** (all properties are capsule/Nespresso) — no per-property field.
- **Complement detail = list « comme le SAS »** (per-line `label : qté × prix = total` + Total),
  EN labels fixed.

### Rules

1. **Coffee line (static, always).** The J-2 body (FR + EN) gains one fixed line, placed right after the
   GPS line:
   - FR: `La cafetière du logement est une machine à capsules (type Nespresso).`
   - EN: `The coffee machine in the property is a capsule machine (Nespresso-compatible).`
   No token, no flag — plain copy. Appears on every J-2 email regardless of reservation.
2. **Complement notice becomes a multi-line list** (only when `complementToCollect`, unchanged:
   `complementAmount > 0 && complementPaid != 1`). Shape (plain-text email → real line breaks):
   ```
   Un complément est à régler directement sur place à votre arrivée :
   - Ménage : 30,00 €
   - Petit déjeuner : 2 × 8,00 € = 16,00 €
   - Taxe de séjour : 4,80 €
   Total : 50,80 €
   ```
   EN mirror:
   ```
   A balance is payable directly on site on arrival:
   - Cleaning: 30.00 €
   - Breakfast: 2 × 8.00 € = 16.00 €
   - Tourist tax: 4.80 €
   Total: 50.80 €
   ```
3. **Per-line format** = the SAS `lineText` rule: `label : qté × prix = total` when `qty > 1 && unit > 0`,
   else `label : total`. (FR uses ` : ` / `Total : `; EN uses `: ` / `Total: `.)
4. **Line source + localisation.** Lines come from the shared builder
   `arrivalComplementDetailFromReservation` (the SAS source of truth), enriched with `qty`, `unitPrice`
   and a `kind` tag (`option` | `resource` | `tax` | `remainder`):
   - `option` / `resource` → the item's title (French title as today — EN title localisation is out of
     scope, §8),
   - `tax` → FR « Taxe de séjour » / EN « Tourist tax »,
   - `remainder` (« Complément d'arrivée » balancing line) → FR « Complément d'arrivée » / EN
     « Arrival balance ».
   The email builder localises `tax`/`remainder` by `kind`; item titles pass through.
5. **Total** = the authoritative `complementAmount` (the detail always sums to it — the builder appends a
   `remainder` line when the itemised lines fall short). One `Total` line closes the list.
6. **Fallback path unchanged in spirit.** When a caller does not pass `arrivalComplementDetail` (rare —
   the J-2 auto-send + preview + manual/scheduled sends all pass it), the inline `inComplementItems`
   fallback is reused but rendered with the **same list format** (no qty/unit available there → `label :
   total` per line + Total). Keeps a single visual style.
7. **Propagation to existing installs.** The J-2 force-sync migration (`runArrivalReminderJ2Migration`)
   currently overwrites only FR `subject`/`body`. Extend it to also force `subjectEn`/`bodyEn` from the
   registry so the coffee line + copy reach already-seeded EN rows. Consistent with the migration's
   existing « overwrite even if personalised » intent for this one template (keeps `sendMode`/`enabled`).

**Edge cases:**
- Complement = pure tourist tax → single line `- Taxe de séjour : 11,96 €` + `Total : 11,96 €`.
- Complement with an accommodation auto-gap → the `remainder` line (« Complément d'arrivée ») carries it,
  so the list always reconciles to the Total.
- `complementPaid = 1` → no notice (unchanged).
- Multi-quantity option (e.g. breakfast ×2) → `Petit déjeuner : 2 × 8,00 € = 16,00 €`.

---

## 4. Architecture

> Fat backend: the amount + breakdown are server-computed (pricing → stored `complementAmount` +
> `arrivalComplementDetailFromReservation`). The email builder only shapes localised text. No client work.

### 4.1 Server (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `utils/` | `defaultEmailTemplatesRegistry.js` | T | Add the coffee line to `ARRIVAL_REMINDER_1D_BODY` (FR) + `ARRIVAL_REMINDER_1D_BODY_EN` (EN), after the GPS line. |
| `models/` | `reservationsModel.js` | T | `arrivalComplementDetailFromReservation`: add `qty`, `unitPrice`, `kind` to each detail line (additive — existing `label`/`amount` untouched). |
| `utils/` | `emailContextBuilder.js` | T | Rebuild `complementNotice` as the multi-line list (§3.2–3.5): per-line SAS format, `kind`-based FR/EN label localisation, `Total` line. Both the SAS-detail path and the inline fallback render the list. |
| `utils/` | `migrateArrivalReminderJ2.js` | T | Also force-sync `subjectEn`/`bodyEn` from the registry (rule 7); EN columns guarded for pre-bilingual schemas. |
| `database.js` | `database.js` | T | Bump the run-once guard `arrival_reminder_j2_overwrite_v1` → `_v2` so the force-sync re-runs once and re-propagates the new copy (coffee line + EN) to already-seeded rows. No schema change. |

### 4.2 Client (`client/src/`)

None. The SAS dialog (`ReservationSasDialog.js`) is the visual reference we mirror; it is unchanged.

### 4.3 API

No contract change. The email preview/auto-send responses carry the reworded `complementNotice` body.

---

## 5. Data model

No schema change. `arrivalComplementDetailFromReservation` gains fields on its returned line objects
(`qty`, `unitPrice`, `kind`) — additive, no persistence. The email is plain-text (`emailService.send`
sends `{ text }`), so `\n` in `complementNotice` renders as real line breaks.

## 6. UI / UX

Email body only (no app screen). Plain-text, so the list renders as dashed lines + a Total, matching the
SAS recap's structure. FR + EN. No responsive concern (email client renders text). The coffee line sits
just under the GPS line in the « informations utiles » area.

## 7. Test plan

### Server unit tests
- [x] `default-email-templates-registry.unit.test.js` — J-2 FR + EN bodies contain the coffee/capsule
  line (FR « machine à capsules (type Nespresso) », EN « capsule machine »).
- [x] `email-context-builder.unit.test.js` — complement assertions in the list format: multi-item →
  one `- label : …` line per item, `qty × unit = total` when qty>1, `Total` line; EN → labels localised
  (`Tourist tax`, `Arrival balance`); tourist-tax-only → single line + Total; `complementPaid=1` /
  `complementAmount=0` → empty notice; fallback path → list format (+ remainder); pure auto-gap (no
  itemisable line) → one-line amount sentence.
- [x] `sas-commit.unit.test.js` — `arrivalComplementDetailFromReservation` carries `qty`/`unitPrice`/
  `kind`; detail still sums to `complementAmount` (existing sum test unchanged).
- [x] `email-template-renderer.unit.test.js` — full J-2 body renders the complement list / one-line
  fallback correctly.
- [x] `arrival-reminder-j2-migration.unit.test.js` — migration also force-syncs `subjectEn`/`bodyEn`
  (incl. the coffee line), degrades gracefully on a pre-bilingual (no EN columns) schema, idempotent,
  preserves `sendMode`/`enabled`.
- [x] Full server suite: **2009/2009**.

### Manual verification
- [x] Rendered the J-2 email end-to-end from the DB template row (post-migration) — coffee line present
  FR + EN, complement as a list + Total.
- [x] Multi-item complement (Ménage 1×30, Petit déjeuner 2×8=16, taxe) FR + EN → correct list, EN tax =
  « Tourist tax ».
- [x] Tourist-tax-only complement → single line + Total.
- [x] Migration force-syncs the DB row (FR + EN coffee line, `dayOffset -2`), `_v2` guard recorded.
- [x] No client change → client suites unaffected.

## 8. Out of scope

- Per-property coffee-machine description (a settings/property field) — chose static text.
- EN localisation of **option/resource titles** in the complement list (`getByIdWithDetails` doesn't
  surface `titleEn`/`nameEn`; the list keeps the French item titles, as today). Only the system labels
  (tax, remainder) are localised.
- The J-7 reminder, SAS dialog, and any non-J-2 template.
- Changing how `complementAmount` itself is computed (pricing engine untouched).

## 9. Open questions

- Q: Coffee line static vs per-property? — **A (2026-07-16):** static text, all properties.
- Q: Complement detail inline vs SAS-style list? — **A (2026-07-16):** SAS-style list (`label : qté ×
  prix = total` + Total), EN labels fixed.
