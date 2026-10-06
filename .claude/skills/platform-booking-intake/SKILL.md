---
name: platform-booking-intake
description: Complete a GuestFlow reservation fiche from the platform's extranet when a new OTA booking arrives (Booking.com today, other platforms later) — guest identity, contact, language, party composition, booking number, bed linen and the « Paiement plateforme » block. Use when the operator says a new Booking/Airbnb/… reservation came in, gives a platform booking number, or asks to fill or check a platform fiche.
---

# Completing a platform reservation fiche

The iCal import only carries dates. Everything else — who the guest is, how many people, and above
all **which amounts go in « Paiement plateforme »** — is copied from the platform's extranet. Copying
by hand is where the money errors come from; this skill does it from the platform's own figures and
proves the result against the payout.

Per-platform field maps, URLs and money rules live in `references/<platform>.md`. Read the one for
the reservation's platform before touching anything. **If no reference exists for the platform, stop
and ask the operator to show the flow once** — never guess a money rule.

## Ground rules

- **The operator logs in to the extranet themself** (password + 2FA) in the Playwright browser. Never
  type, store or log platform credentials.
- **Read, then write.** Collect every value from the extranet first, show the operator the planned
  entries, then fill GuestFlow.
- **Never enter a derived amount you could not check.** Every financial value comes verbatim from the
  extranet or from the formula in the platform reference, and the fiche must end on « ✓ cohérent avec
  le virement ».
- Prod data: the fiche is saved only after the planned entries were shown to the operator.

## The loop

1. **Find the GuestFlow fiche.** Calendar → the property → the stay (the iCal import created it, guest
   name usually empty or the platform's placeholder). Note its id.
2. **Find the extranet reservation.** By booking number if known, else the platform's latest
   reservations list, matching dates + guest initials.
3. **Collect** (see the platform reference for where each value sits):
   - guest first/last name, phone, email, country, preferred language;
   - arrival/departure, nights (check they equal the fiche's dates — a mismatch means the wrong stay);
   - adults + every child's age;
   - booking number;
   - arrival/departure times or special requests, if any;
   - options/extras booked (usually none: the price breakdown shows only nights + tourist tax);
   - the money figures named in the reference.
4. **Fill the client fiche**: name, phone, email. **Email language: `fr` when the preferred language
   is French, otherwise `en`** (decided 2026-10-06 — Dutch, German… all get English). It is the
   **client's** language that drives the emails (`reservationEmailSender.js` reads
   `client.emailLanguage` before `reservation.emailLanguage`); judge the language there, not on the
   reservation.
5. **Fill the reservation fiche**:
   - party by GuestFlow's age bands: Adultes ≥ 18, **Ados 12 à 18 ans**, **Enfants 2 à 12 ans**,
     **Bébés 0 à 2 ans**. Map each listed age; re-count the total against the platform's headcount;
   - canal = the platform; booking number replaced by the platform's;
   - « Linge de lit » → **« Suggérer les lits »** once the party is entered;
   - « Paiement plateforme » per the reference, **in the order it gives** (the « Calculer la
     commission » button reads the tourist-tax box — click it last).
6. **Check before saving**: « Net perçu » = the expected payout, ✓ shown; « Total du séjour » and
   « Montant soumis à commission » in « Résumé tarifaire » match the reference's expectation.
7. **Save, then re-read** the reservation (`GET /api/reservations/<id>` from the GuestFlow tab) and
   report the stored figures to the operator in one short table.

## Dry run

Asked to « rejouer » or « vérifier » an already-entered fiche: run steps 1–3, compute the planned
entries of steps 4–5 without typing them, and report a two-column table — planned vs stored — with
every difference called out. Nothing is typed, nothing is saved. Done on 22304 on 2026-10-06: zero
difference.

## When a reference is wrong

The payout is the ground truth: each platform shows, after the fact, what it actually transferred.
When a past reservation's payout disagrees with what the reference predicts, the reference is wrong —
fix it, say so, and list the fiches entered under the old rule. Do not silently re-enter them.
