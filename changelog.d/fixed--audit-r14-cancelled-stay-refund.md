- **Refunds on a cancelled stay reduce the indemnity (audit R14-M1).** A cancelled stay now offers to refund only
  the money it actually collected, never the unpaid remainder; the share beyond any non-requalified money (a paid
  solde keeps its 706 + VAT refund) is booked as a debit of the cancellation indemnity account (75880000, 0 %), so
  « Location gîte » and VAT stay exact. A refund above what was collected, or an indemnity share in caisse interne,
  is refused. Accounting export plugin 1.0.22 (specs/reservation-refunds.md rule 48).
- **The fiche ledger no longer shows a kept acompte as a refund (audit R14-C1).** A cancellation's retained avoir
  reads « Acompte conservé » (« Échéances conservées » for a plan) · « Requalifié en indemnité le JJ/MM » instead
  of « Remboursement · Rendu le … · retained »; a refund taken from the indemnity reads « Rendu sur l'indemnité ».
