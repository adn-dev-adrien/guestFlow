- **Money fields — a pasted amount no longer erases itself** (spec `reservation-price-arithmetic.md`
  rules 8-9, 2026-09-25). Copying `1 197,00 €` off a platform statement into « Total séjour facturé
  par la plateforme », « Virement reçu », a commission or any other money field used to blank the
  field on Enter: the currency symbol and the thousands separator made the entry unreadable, and an
  unreadable entry silently reverts to the last committed value — empty, on a reservation being
  reconciled for the first time. The euro sign (and `$`, `£`, `EUR`), every kind of space between
  thousands (including the non-breaking ones a copy-paste carries) and an unambiguous thousands dot
  (`1.197,00`) are now read for what they are. `1.234+5.678` still means `6.912`. +7 client tests.
