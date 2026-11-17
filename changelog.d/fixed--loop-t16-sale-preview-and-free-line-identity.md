- **Price preview: an option added on a stay or a devis holding a free line is priced at its own price.** The fiche sent the free line's
  amount as a unit price under a key naming no article, and the preview priced the new option (or a raised quantity) at it — 225 € shown
  for a 120 € option the save stored at 120 €. The fiche no longer sends it, and the server ignores any such key (pricing-components rule 94
  reading, loop t16 S16-1).
- **An admin-unlocked fiche saves the routing its preview shows.** Every quote of the fiche — the live preview, the one taken at
  « Enregistrer », « Actualiser les tarifs », the ledger's — now goes through one request body; the quote taken at the save lacked the
  unlock, so a resource moved out of the complement on an unlocked fiche was saved where it was (loop t16 S16-2).
- **Free lines keep their own identity.** A 0 € line no longer turns the only « Ménage » into « Ménage (2) »; a free line removed and typed
  again in one save is a new line (no inherited discount or number; a paid one is refused); an arrival SAS re-run that only changes an
  item's case keeps its line (loop t16 S16-3).
