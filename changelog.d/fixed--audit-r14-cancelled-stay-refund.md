- **Refunds on a cancelled stay reduce the indemnity (audit R14-M1).** A cancelled stay now offers to refund only
  the money it actually collected, never the unpaid remainder; the share beyond any non-requalified money (a paid
  solde keeps its 706 + VAT refund) is booked as a debit of the cancellation indemnity account (75880000, 0 %), so
  « Location gîte » and VAT stay exact. A refund above what was collected, or an indemnity share in caisse interne,
  is refused. The indemnity share is split HT / VAT cumulatively over the stay, so a fully given-back indemnity nets
  75880000 and VAT to the cent at any compensation rate; what the caisse interne gave back of the sale no longer
  leaves room for a later line to be booked as a sale. The franchise turnover subtracts an indemnity refund at face
  value, a VAT regime switch leaves indemnity lines at 0 %, and reopening a kept acompte's card warns when refunds
  already reduced it. Accounting export plugin 1.0.22 (specs/reservation-refunds.md rule 48).
- **The fiche ledger no longer shows a kept acompte as a refund (audit R14-C1).** A cancellation's retained avoir
  reads « Acompte conservé » (« Échéances conservées » for a plan) · « Requalifié en indemnité le JJ/MM » instead
  of « Remboursement · Rendu le … · retained »; a refund taken from the indemnity reads « Rendu sur l'indemnité ».
