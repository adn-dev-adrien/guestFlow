- **A refund recorded on a cancelled stay can be deleted from the fiche again.** The fiche of a cancelled stay offered
  « Supprimer » on no refund, so a mistyped amount stayed in the journal and on the compensation card. It now offers it,
  outside the read-only fields, on the refunds made after the cancellation; never on « Acompte conservé », which the
  server now refuses to delete too (« L'acompte conservé ne se supprime pas. »: deleting it left the indemnity booked
  while the revenue reversal was gone), nor on a refund the cancellation already read (« Remboursement antérieur à
  l'annulation. »).
- **Caisse-interne money on a cancelled stay stays off the books, and can be given back.** An acompte collected in the
  caisse interne was requalified as if it had been booked (706 and VAT debited on a sale never booked, 7588 credited
  with money off the books); it no longer is. The register of a cancelled stay now offers what the caisse interne
  collected, beside the indemnity, given back in the caisse interne only (« Encaissé en caisse interne : rendu en
  caisse interne seulement. » by transfer): a solde of 640 € held in cash could not be given back at all.
- **The commissions a payment provider withheld are requalified at the cancellation.** On a direct stay collected
  through Lodgify / Stripe, the commissions on the paid acompte and solde stayed as sales revenue with collected VAT
  once everything was given back (stay #22226: 6,20 € HT and 0,62 € of VAT). The cancellation's avoir and indemnity
  now include them, the register never offers them back from the indemnity, and 706, 4457, 4671 and the client
  account end at 0 (7588 keeps the commissions, 622600 their cost). Past cancellations' exports do not move.
