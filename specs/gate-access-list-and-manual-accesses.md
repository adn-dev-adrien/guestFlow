# Gate access list and hand-made accesses (friends, family, the neighbour)

| Field | Value |
|---|---|
| **Status** | Draft — **the HTML summary is what decides** (`specs/guest-gate-access-maquettes.html`) |
| **Branch** | `feature/gate-access-list` _(user-managed, not created yet)_ |
| **Created** | 2026-09-14 |
| **Author** | Adrien |
| **Related** | [guest-gate-access.md](guest-gate-access.md) — this extends it; that spec owns the guest half and the Sowel contract |

---

## 1. Context

`guest-gate-access.md` gave every **reservation** an access to the gate: a per-stay code, a window
derived from the booking, a journal, and a revocation. It made one assumption that the feature has
now outgrown — **that an access is always born from a stay**.

A friend coming to water the plants has no reservation. The neighbour holding a spare key has no
reservation. They are left with the physical code, which is exactly what this whole feature exists
to retire.

There is also no page where the accesses can be *seen*. Each one is visible on its own reservation
fiche, which answers « what about this stay » and never « who can open my gate right now ».

## 2. Goal

One page that lists every access to the gate — the ones GuestFlow creates for stays and the ones
the owner creates by hand — where each can be suspended, regenerated or deleted, and where a
hand-made access is valid either **over a date range** or **always**, optionally restricted to
**times of day**.

## 3. Functional rules

### 3.1 Two kinds of access

1. An access carries a **`kind`**: `stay` (created on demand from a reservation, as today) or
   `manual` (created by the owner on this page). Everything already specified about a `stay` access
   is unchanged.
2. A `manual` access carries a **label** — who it is for. It is required: an access whose name is
   « — » is one nobody will dare delete in six months.
3. **A `stay` access cannot be deleted.** It would be recreated on the next email render or fiche
   read, since it is minted on demand from the reservation. Those rows offer *suspend* and *revoke*.
   (If they must truly disappear, the reservation itself has to carry a « no gate access » flag —
   named in §9 as an open question, not assumed here.)
4. **A `manual` access can be deleted**, and then it is gone from the list. The journal survives:
   `gate_events` deliberately carries no foreign key, so « who came in that night » outlives a
   tidy-up.

### 3.2 Validity

5. A `manual` access is either **ranged** (`validFrom` → `validUntil`, both stored) or
   **permanent** (both null). A range refuses an end before its start, at the API and in the form.
6. **Time-of-day windows** (`timeWindows`, a JSON array of `{ from, to }` in `HH:MM`) restrict when
   the access may *command* the gate. Empty means any hour.
   - Windows apply **every day**. Days of the week are out of scope (§8).
   - A window whose end is not after its start is refused — no window crossing midnight for now.
   - Overlapping windows are refused: two overlapping rules make the effective one unguessable.
   - Windows are allowed on a ranged access too. It costs nothing and the field is already there.
7. **Suspension** (`suspendedAt`) is a third axis, not a state: it keeps the code and the schedule
   and takes the access out of service until it is resumed. It applies to both kinds.
8. The effective decision at press time is therefore, in order: not deleted → not suspended → not
   revoked → inside the validity (stay window, range, or always) → inside a time window if any.
   Each refusal answers with its own reason, because « ça ne marche pas » in front of a gate is
   what generates a phone call.

### 3.3 The list

9. One page, every access, **sorted so the ones needing attention come first**: an *active*
   `manual` access with no use for 90 days surfaces at the top, carrying an « inutilisé 90 j » tag.
   A *suspended* one does not surface — it has already been dealt with, and asking twice for the
   same decision is how a warning becomes noise.
10. **A `stay` access is identifiable at a glance**: a « guestFlow » tag against « créé par moi »
    for a manual one. Its line also names the lodging and the stay number.
11. Filters: by kind (all / mine / guestFlow) and by state (all / active / inactive).
12. Each line shows the code, what the validity amounts to in words, the device count, the last use,
    and its actions.
13. **No automatic expiry of a permanent access.** On an access with no end, the protection is no
    longer time — it is the owner reading this list. An access that dies unannounced in front of a
    gate at night is worse than the risk it covers.

### 3.4 Confirming the intent to open (guest page)

14. The guest page's button becomes a **slide-to-confirm**, the same gesture as the Sowel dashboard
    tile (Sowel spec 146): the knob must be dragged to the end; released before it, nothing is sent.
    The mechanics are taken as they are, including the **track capped at 260 px and centred** —
    tuned by hand on a phone, because full width puts the start in the corner farthest from the
    thumb of the hand holding it, on a control whose whole purpose is one-handed use in front of a
    gate.
15. The label follows the contact, as the button does today: « Glisser pour ouvrir » when closed,
    « Glisser pour fermer » when open. It **names**, it never blocks (guest-gate-access.md §3.8).
16. **After a send, the slider returns to rest after 2 s.** No lock: a guest must be able to send
    another command (guest-gate-access.md §3.5 rule 18).

**Edge cases:**
- A permanent access pressing outside its windows → refused with « hors des heures autorisées »
  and the next opening time, not a flat failure.
- A manual access whose range has passed → the page says the access has ended, like a stay.
- Deleting a manual access while its phone has the page open → the next press answers 401 and the
  page falls back to the code form.

---

## 4. Architecture (outline — to be detailed once the HTML is approved)

- `gate_accesses` gains `kind`, `label`, `validFrom`, `validUntil`, `suspendedAt`, `timeWindows`,
  `createdBy`. All nullable, all ignored for a `stay` row, so the migration is additive and the
  existing rows keep their behaviour by carrying nulls.
- `utils/gateWindow.js` grows a resolver that answers « is this access commandable now » from the
  three shapes (stay-derived, ranged, permanent) plus the windows. The stay path stays exactly as it
  is — it is already tested against both DST transitions.
- A new admin tree `/api/gate-accesses` (list, create, update, suspend, resume, delete) behind the
  ordinary session guard; the guest tree is untouched.
- Client: a page under Réglages, and the slider on the guest page.

## 5. Verification

The HTML summary is not documentation of the plan, it **is** the plan being judged:
`specs/guest-gate-access-maquettes.html`, self-contained, no network. It carries three working
mockups — the slider (release early and nothing fires), the list (suspend, regenerate, delete, and a
delete deliberately disabled on guestFlow rows), and the creation form (including the refusals: an
end before a start, overlapping windows, a missing name).

## 8. Out of scope

- **Days of the week** on the windows. « Every day 08:00 → 20:00 » covers the friend watering the
  plants; « Tuesdays only » is a different need, added the day it exists.
- **Accounts or passwords** for these accesses: the code and the link, as for guests.
- **Per-access notifications.** The journal is the record; the existing push (past 6 devices) does
  not change.
- **Usage limits** beyond the ceilings already in place (12/h per access, 30/h for the gate).

## 9. Open questions

- Q: Should a `stay` access be deletable, via a « no gate access » flag on the reservation?
  - A: —
- Q: Time windows every day, with no day-of-week choice — enough?
  - A: —
- Q: An active permanent access unused for 90 days surfacing at the top of the list: useful, or noise?
  - A: —
- Q: The slide gesture, or a long press?
  - A: —
