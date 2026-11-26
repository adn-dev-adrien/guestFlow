# Booking.com

## Where things are (extranet, `admin.booking.com`)

- Property ids: **La Granja = 14407976**. (L'Estiva: note it here the first time it comes up.)
- Reservation page: `extranet_ng/manage/booking.html?hotel_id=<id>&res_id=<booking number>` (the
  `ses=` session parameter is added by the extranet; take it from the current URL).
- On that page, in order: dates, nights, « Nombre de personnes » with **every child's age in
  parentheses**, « Montant total », guest name + country code + relay email
  (`…@guest.booking.com` — that relay is the email to store), phone (sometimes behind « Afficher le
  numéro de téléphone »), « Langue préférée », « Numéro de réservation », « Montant soumis à
  commission », « Commission et frais », then the nightly breakdown ending in « Sous-total », « Taxe
  de séjour », « Tarif total de l'hébergement ».
- Payouts: Comptabilité → **Informations de versement** (`payouts.html`). Clicking a payout reference
  lists, per reservation: Montant, Commission, Frais de service de paiement, **Net**. This is the
  ground truth for the money rule below.

## Money rule (measured 2026-10-06)

Measured on the two payouts received so far:

| Reservation | Montant total | Commission | Frais de paiement | Net viré |
|---|---|---|---|---|
| 5300000001 (Romeo, GuestFlow 22219) | 1 283,34 | 190,10 | 17,97 | 1 075,27 |
| 5300000002 (Omega, GuestFlow 22280) | 1 184,61 | 173,64 | 16,58 | 994,39 |

**Payout = « Montant total » − « Commission et frais ».** The tourist tax is inside « Montant total »
and is **not** withheld: it comes back in the payout. « Commission et frais » = 15 % of « Montant
soumis à commission » + ~1,4 % payment fee on « Montant total » (2026-10-06: 302,13 + 28,59 = 330,72).

## Entry order in « Paiement plateforme » (specs/platforms/platform-host-statement-and-commission-vat.md rules 1, 5, 21, 22)

The block takes the **host side** of the statement: the figures never contain the tourist tax nor a fee the
guest paid Booking. Booking is in tourist-tax mode « plateforme collecte et reverse » (the tax comes back in
the payout), so the box is the tax **paid with the transfer**.

1. **Location (relevé)** = « Sous-total » (the commissionable amount). **Never** « Montant total »
   (tax included).
2. **Options (relevé)** = 0, unless the extranet lists extras. The fiche follows it: a paid option the
   statement does not count goes to « offerte » by itself (the block says so).
3. **Taxe de séjour** = the « Taxe de séjour » line of the page (Booking's figure, not GuestFlow's
   estimate — they differ). The gap with GuestFlow's own tax goes into the accommodation (the block says so).
4. **Virement reçu (contrôle)** = « Montant total » − « Commission et frais ».
5. **Calculer la commission** — only now. It equals « Commission et frais »: Sous-total + tax − virement.

Expected: « Net perçu » = the virement, with ✓; the commission rate line stays quiet (Booking ≈ 16,44 %).

Worked example, Gilibert: Sous-total 690 / tax 20,02 / virement 596,58 → commission 113,44; the tax GuestFlow
computes (26,40) is the right one for 46710000, the 6,38 of gap comes out of the accommodation.

## Reading the page

Read `document.body.innerText` of the reservation page, after replacing `\u00a0`, `\u202f` and
`\u200b` with spaces: Booking puts a narrow no-break space before every « : » and zero-width spaces
between the children's ages, so an exact `"Durée de séjour :"` lookup silently returns nothing. Match
the label, an optional `:`, then the next non-empty line. Other traps:

- the guest name line ends with « Identité vérifiée »; strip it. Booking writes « Prénom Nom »;
- the 2-letter country code sits on the line between the name and the relay email;
- the phone may be hidden behind « Afficher le numéro de téléphone »: click it first;
- « Conversation avec le client » followed directly by « Envoyez un message de bienvenue » means the
  guest wrote nothing (no arrival time, no request).

## Party

Booking lists ages, e.g. « 4 adultes et 6 enfants (3, 6, 8, 10, 15 et 15 ans) » → Adultes 4,
Enfants (2–12) 4, Ados (12–18) 2, Bébés 0.

## Not on Booking

No arrival/departure times are given unless the guest wrote a message; check the conversation block.
