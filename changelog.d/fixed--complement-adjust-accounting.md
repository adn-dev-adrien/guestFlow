- **An adjusted complement is booked at the amount that was announced, poste by poste**
  (specs/adjustable-complement-amounts.md §3.6). The fiche decides and stores the ventilation
  (`70600000` / `70600010` / `70601000`, tourist tax and accommodation untouched) and the export only
  splits TTC into HT + VAT. Three mechanisms would otherwise have silently corrupted the entry: the
  export's residue nudge, which lands on the **last** credit line — the `46710000` tourist tax (a
  93,60 € complement announced at 85 € would have declared 1,00 € of tourist tax); the re-derived tax
  share; and the gross-up ratio, which took the complement into its denominator and therefore
  re-inflated both the complement entry and the acompte / solde entries of the same reservation.
