- **An acompte collected by a payment link can no longer be erased by « Sans acompte ».** A fiche still holding
  the switch from before the link was booked (saved with « Enregistrer quand même », by a script, or in the same
  second) zeroed the acompte, its payment and its journal entry again. The save and the live quote now keep an
  acompte a paid link collected; an acompte ticked by hand without a link can still be switched off. Review of
  PR #893 (`specs/disable-deposit-per-reservation.md` rule 13).
- **An acompte link paid after the solde was collected no longer lowers the paid solde.** The acompte is booked
  on top, the excess shows as a trop-perçu to refund, and the admin alert says « solde déjà perçu » and asks for
  the refund, with no confirmation sent to the guest. Review of PR #893 (`specs/plugins-phase-3a-online-payment.md`
  rule 49).
- **« Sans acompte » is greyed out on an acompte a payment link collected, with the reason under it.** The switch
  used to look free, the summary previewed the acompte as gone, and the save silently put it back. A refused switch
  also keeps the acompte's recorded amount and deadline, so the history no longer reports a cleared acompte or a
  new deadline. Re-review of PR #893 (`specs/disable-deposit-per-reservation.md` rule 13).
