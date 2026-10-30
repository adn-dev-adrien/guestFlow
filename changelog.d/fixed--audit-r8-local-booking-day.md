- **Payment schedule — booked on the operator's day** (specs `payment-schedule-and-cancellation.md` rule 54,
  `finance-dashboard-redesign.md` rule 50, review of PR #899, 2026-10-30). The schedule read the booking
  day as the first ten characters of the UTC `createdAt`: a devis created between 00:00 and 01:00 / 02:00
  in Paris, 30 days before arrival, was sold as one single payment and flipped to a 30 % acompte with the
  solde due before it at its first unchanged save; a reservation's fiche showed that acompte too. The
  schedule, the pace's booking day, the earliest arrival-payment date and the Clients « Créé le » now read
  the local day. +11 server tests.
