- **Un-marking a collected arrival complement now takes effect immediately**
  (specs/defer-arrival-complement-to-checkout.md §3.3 rule 16ter). « Marquer complément payé » only
  called the server on a *locked* reservation; everywhere else it changed the form and waited for a
  « Enregistrer », while every neighbouring button — « Caisse interne », the end-of-stay card, the
  check-out switch — wrote straight away. Form and database then disagreed, and the database is what
  decides whether the two cards merge: un-marking a payment and then deferring merged nothing. That
  mismatch also explains the « impossible » screen reported earlier — the control visible (form) next
  to two separate cards (server).
- **A prestation is no longer listed twice on the merged card.** A line routed to the end-of-stay
  complement mid-stay was still listed at full price on the arrival side, so the merged card showed it
  once per side and its lines no longer summed to the total. The arrival detail now deducts the part
  that moved, exactly as the engine and the accounting do.
