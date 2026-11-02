- **Cancelled stay — the fiche's « Supprimer » on an absorbed refund is now tested end to end** (spec
  `payment-schedule-and-cancellation.md` rule 55 reading, audit R17-L1). Two server tests read the fiche through
  `reservationsController.getById` on the real database and hold it to the DELETE route (100 € absorbed: offered and
  deleted; 700 €: neither). A failure reading the cancellation's netted refunds is now logged instead of silently
  hiding « Supprimer ». +2 server tests.
