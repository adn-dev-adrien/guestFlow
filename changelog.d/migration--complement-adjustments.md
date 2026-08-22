- `reservations` gains `complementAmountOverride` and `endOfStayComplementAmountOverride` (REAL, NULL
  = automatic, i.e. today's behaviour) plus `complementAllocation` (TEXT, JSON, NULL = the accounting
  postes are derived exactly as before). Nothing is rewritten at boot: existing reservations keep
  their amounts and their accounting entries to the cent.
