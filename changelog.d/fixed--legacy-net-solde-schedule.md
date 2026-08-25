- **The fiche and the books agree on what a stay collected** (spec `legacy-net-solde-schedule-repair.md`,
  2026-08-25). On a reservation from the « solde = net » era, the solde stored the amount already net
  of the platform commission while the commission was recorded beside it, so every screen that
  deducts it — « encaissé », reste à payer, total du séjour — deducted it twice: the fiche read
  812,00 € where the bank transfer and the accounting journal both said 903,00 €. A one-shot boot
  migration puts each commission back into its own échéance, so the schedule sums to the stay total
  again. The journal is untouched by design and by proof: the export's gross-up branch simply stops
  being needed, and the 43 entries of February → August 2026 come out identical to the cent. Nothing
  ambiguous is repaired — a schedule that drifted for any other reason is left exactly as it is.
  +9 server tests.
