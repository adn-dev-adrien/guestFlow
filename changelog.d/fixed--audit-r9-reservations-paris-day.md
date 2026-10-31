- **Platform price check and two date labels — read on the operator's day** (specs
  `reservation-payment-ledger.md` rule 65, `direct-installments.md` rule 49, `guest-email-sequence.md`
  rule 36, `finance-dashboard-redesign.md` rule 50, audit R9-1, 2026-10-30). The « prix plateforme hors
  grille » alert compared the tariff journal with the first ten characters of the UTC `createdAt`: a
  platform stay booked between 00:00 and 01:00 / 02:00 in Paris lost the alert whenever the tariff moved
  earlier that same day. « Demandée le … » on an installment and « Déjà envoyé le … » in the sequence
  simulation showed the day before for a request or a mail sent in that window. All three now read the
  local day. The journal side keeps a manual entry on the wall time typed in the form, so a platforms change
  declared late in the evening no longer silences the alert of a stay booked after it the same evening.
  +4 server tests.
