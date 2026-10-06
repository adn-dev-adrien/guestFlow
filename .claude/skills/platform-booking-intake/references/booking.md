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
| 5343871259 (Foury, GuestFlow 22219) | 1 283,34 | 190,10 | 17,97 | 1 075,27 |
| 5326061022 (Mairet, GuestFlow 22280) | 1 184,61 | 173,64 | 16,58 | 994,39 |

**Payout = « Montant total » − « Commission et frais ».** The tourist tax is inside « Montant total »
and is **not** withheld: it comes back in the payout. « Commission et frais » = 15 % of « Montant
soumis à commission » + ~1,4 % payment fee on « Montant total » (2026-10-06: 302,13 + 28,59 = 330,72).

GuestFlow keeps Booking in tourist-tax mode « plateforme collecte et reverse » (operator, 2026-10-06:
Booking remits the tax to the commune). That mode has no slot for a tax that comes back in the payout,
so the operator chose (2026-10-06, option « B ») the entry below. It gets the payout and the revenue
right; the stored commission is lower than Booking's « Commission et frais » by exactly the tax. This
is a known, accepted gap pending the accountant's opinion — do not « fix » it on your own.

## Entry order in « Paiement plateforme »

1. **Montant total payé par le client** = « Montant total » (tax included). **Never** « Montant soumis
   à commission » — that one is already tax-excluded, and GuestFlow subtracts the tax again.
2. **Taxe de séjour retenue** = the « Taxe de séjour » line of the breakdown (Booking's figure, not
   GuestFlow's estimate — they differ: Booking applies 4,4 % of the price).
3. **Virement reçu (contrôle)** = « Montant total » − « Commission et frais ».
4. **Calculer la commission** — only now, after the tax box is filled.

Expected result: « Montant soumis à commission » in the summary = Booking's « Sous-total »; « Net
perçu » = the virement, with ✓.

Worked example, 5449776734 (GuestFlow 22304, entered 2026-10-06): 2 042,21 / 28,03 / 1 711,49 →
commission 302,69, total séjour 2 014,18.

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
