# Gate access list and hand-made accesses (friends, family, the neighbour)

| Field | Value |
|---|---|
| **Status** | Draft — **the HTML summary is what decides** (`specs/guest-gate-access-maquettes.html`); second round reviewed 2026-09-14 |
| **Branch** | `feature/gate-access-list` _(user-managed, not created yet)_ |
| **Created** | 2026-09-14 |
| **Author** | Adrien |
| **Related** | [guest-gate-access.md](guest-gate-access.md) — this extends it; that spec owns the guest half and the Sowel contract |

---

## 1. Context

`guest-gate-access.md` gave every **reservation** an access to the gate: a per-stay code, a window
derived from the booking, a journal, and a revocation. It made two assumptions that the feature has
now outgrown.

**That an access is always born from a stay.** A friend coming to water the plants has no
reservation. The neighbour holding a spare key has no reservation. They are left with the physical
code, which is exactly what this whole feature exists to retire.

**That an access can be minted on demand.** The row was created the first time it was needed — the
first email render, the first fiche read. That is invisible until you try to *delete* one: it comes
back at the next email, with a new code. The owner named this on 2026-09-14 while asking a
different question, and it is the reason §3.2 exists.

There is also no page where the accesses can be *seen*. Each one is visible on its own reservation
fiche, which answers « what about this stay » and never « who can open my gate right now ».

## 2. Goal

One page that lists every access to the gate — the ones GuestFlow creates for stays and the ones
the owner creates by hand — where each can be **edited, suspended or deleted**, and where a
hand-made access is valid either **over a date range** or **always**, optionally restricted to
**times of day**.

## 3. Functional rules

### 3.1 Two kinds of access

1. An access carries a **`kind`**: `stay` (born with a reservation, §3.2) or `manual` (created by
   the owner on this page).
2. A `manual` access carries a **label** — who it is for. It is required: an access whose name is
   « — » is one nobody will dare delete in six months.
3. **Both kinds can be deleted**, and then they are gone from the list (decision 2026-09-14). The
   journal survives: `gate_events` deliberately carries no foreign key, so « who came in that
   night » outlives a tidy-up.
4. **Suspension** (`suspendedAt`) is not deletion and not a state: it keeps the code and the
   schedule, and takes the access out of service until it is resumed. It applies to both kinds.

### 3.2 Where a `stay` access comes from, and when it goes

5. **The access is created with the reservation**, not on first use, and carries its own
   `validFrom` / `validUntil` written from the stay window (check-in → check-out + 1 h).
   Consequence, and the reason for the change: **a deleted access stays deleted.** The fiche then
   offers « recréer un accès », which is a deliberate gesture rather than a side effect.
6. **Nothing ever asks for its removal.** The access and the reservation live in the same database;
   Sowel holds no list of accesses — it collects an already-authorised request and returns a result.
   There is therefore no « create / delete » conversation between the two halves that could
   desynchronise, in either direction. At the end of the stay the row simply **falls out of the
   list**, because its own end date has passed.
7. **A change to the reservation's dates or times rewrites the stay window**, on the spot. This is
   explicit: the reservation is the source of truth for the stay part of the window.
8. **A hand-made override can only ever widen** (§3.4). Rule 7 therefore cannot shorten an access
   behind the owner's back: the window in force is the **widest** of the stay window and the
   overrides. Moving a departure two days later extends the access; an override set beyond it
   survives untouched; an override the stay has overtaken simply stops mattering.
9. **Retention.** Seven days after the stay ends the row is purged with its code, as
   `guest-gate-access.md` §3.7 already provides. Until then it is reachable under one filter
   (§3.5), for the client who rings back asking for their code.

### 3.3 Validity

10. A `manual` access is either **ranged** (`validFrom` → `validUntil`, both stored) or
    **permanent** (both null). A range refuses an end before its start, at the API and in the form.
11. **Time-of-day windows** (`timeWindows`, a JSON array of `{ from, to }` in `HH:MM`) restrict when
    the access may *command* the gate. Empty means any hour.
    - Windows apply **every day** (confirmed 2026-09-14). Days of the week are out of scope (§8).
    - A window whose end is not after its start is refused — no window crossing midnight for now.
    - Overlapping windows are refused: two overlapping rules make the effective one unguessable.
    - Windows are allowed on **both kinds**, since the owner asked to be able to add hours from the
      list without caring which sort of access he is looking at.
12. The effective decision at press time is therefore, in order: not deleted → not suspended → not
    revoked → inside the validity (stay window widened by its overrides, range, or always) → inside
    a time window if any. Each refusal answers with its own reason, because « ça ne marche pas » in
    front of a gate is what generates a phone call.

### 3.4 Editing from the list

13. Every line carries **« Modifier »**, and what it opens depends on the kind.
14. On a `stay` access the stay window is **shown but not editable** — it belongs to the
    reservation. Two overrides sit under it:
    - **« Ouvrir dès »** (`earlyOpenedAt`, which already exists and is already tested): opens the
      access before the contractual check-in hour. Refused if it is not *before* check-in.
    - **« Prolonger jusqu'au »** (`extendedUntil`, new): keeps it alive after check-out + 1 h.
      Refused if it does not *exceed* the end of the stay — that is not a prolongation, it is an
      early revocation, and for that there is « Suspendre ».
15. On a `manual` access the validity itself is editable: permanent ↔ ranged, and the dates.
16. Time windows are editable on both, with the refusals of rule 11 shown as you type.
17. Every edit writes a `gate_events` line naming what changed and what caused it — a hand edit or a
    reservation that moved. « Why is this access open until Tuesday » must have an answer.

### 3.5 The list

18. One page, every access, in three plain groups: **actifs**, then **suspendus**, then — under its
    own filter only — **séjours terminés (7 derniers jours)**. No attention section, no line that
    jumps the queue: an unused permanent access shows « dernier usage : il y a 112 jours » in its
    own column and asks nothing of anybody (decision 2026-09-14: the 90-day surfacing was noise).
19. **A `stay` access is identifiable at a glance**: a « guestFlow » tag against « créé par moi »
    for a manual one. Its line also names the lodging and the stay number.
20. Filters: by kind (all / mine / guestFlow) and by state (in service / active / suspended /
    finished stays).
21. Each line shows the code, what the validity amounts to in words, the hours, the device count,
    the last use, and its actions.
22. **No automatic expiry of a permanent access.** On an access with no end, the protection is no
    longer time — it is the owner reading this list. An access that dies unannounced in front of a
    gate at night is worse than the risk it covers.

### 3.6 Confirming the intent to open

23. Done, and no longer part of this spec: the slide-to-confirm, its geometry and its wording live
    in `guest-gate-access.md` §3.5 rule 17.bis, implemented on 2026-09-14 in the guest page.

**Edge cases:**
- A permanent access pressing outside its windows → refused with « hors des heures autorisées »
  and the next opening time, not a flat failure.
- A manual access whose range has passed → the page says the access has ended, like a stay.
- Deleting an access while its phone has the page open → the next press answers 401 and the page
  falls back to the code form.
- A reservation moved *into the past* → the stay window closes, the access falls out of the list at
  the next purge, and an override that survives it keeps the line alive until its own end.

---

## 4. Architecture (outline — to be detailed once the HTML is approved)

- `gate_accesses` gains `kind`, `label`, `validFrom`, `validUntil`, `extendedUntil`, `suspendedAt`,
  `timeWindows`, `createdBy`. The migration is additive; existing rows carry nulls and keep their
  behaviour until the backfill of rule 5 runs.
- **Creation moves from lazy to eager**: a hook on reservation creation, a backfill for the existing
  ones, and a `deletedAt` tombstone that the old lazy path must honour if it is kept as a fallback.
- `utils/gateWindow.js` grows a resolver answering « is this access commandable now » from the three
  shapes (stay-derived plus overrides, ranged, permanent) and the windows. The stay path stays
  exactly as it is — it is already tested against both DST transitions.
- A new admin tree `/api/gate-accesses` (list, create, update, suspend, resume, delete) behind the
  ordinary session guard; the guest tree is untouched.
- Client: a page under Réglages.

## 5. Verification

The HTML summary is not documentation of the plan, it **is** the plan being judged:
`specs/guest-gate-access-maquettes.html`, self-contained, no network. It carries the list (edit,
extend, suspend, regenerate, delete — including on a guestFlow row), the creation form with its
refusals, and **two simulations of the cases the owner raised**: a reservation whose departure moves,
and a stay that ends.

## 8. Out of scope

- **Days of the week** on the windows. « Tous les jours 08:00 → 20:00 » covers the friend watering
  the plants; « seulement le mardi » is a different need, added the day it exists.
- **Accounts or passwords** for these accesses: the code and the link, as for guests.
- **Per-access notifications.** The journal is the record; the existing push (past 6 devices) does
  not change.
- **Usage limits** beyond the ceilings already in place (12/h per access, 30/h for the gate).

## 9. Questions, answered

- Q: Should a `stay` access be deletable?
  - A (2026-09-14, Adrien): **yes, from the list — and it also leaves on its own at the end of the
    stay.** Which forced the real fix: creation moves to the reservation, so a deletion sticks
    (§3.2). His words: « Guestflow paramètre un accès lors de la création de la réservation et nous
    avons une date et heure de fin. Guestflow n'a pas à refaire une demande de suppression. »
- Q: Time windows every day, with no day-of-week choice — enough?
  - A (2026-09-14, Adrien): **yes.** « Plage horaire tous les jours c'est ok. »
- Q: An active permanent access unused for 90 days surfacing at the top of the list?
  - A (2026-09-14, Adrien): **noise.** « Pour l'accès de 90 jours c'est du bruit en haut de liste. »
    Removed: no sort, no tag, only the « dernier usage » column.
- Q: The slide gesture, or a long press?
  - A (2026-09-14, Adrien): **the slide**, with a label that names the movement rather than a
    direction. Shipped; see §3.6.
- Q: Still open — the exact wording of the slider, the caption « Le même geste ouvre et ferme », and
  whether the fiche's « Révoquer » should be renamed « Supprimer l'accès » for one vocabulary.
  - A: —
