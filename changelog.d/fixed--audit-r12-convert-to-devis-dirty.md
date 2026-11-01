- **« Transformer en devis » no longer drops unsaved changes** (audit R12-C1, spec `payment-link-lifecycle.md` rule 46,
  reading of 2026-11-01). The devis is built from the stored stay, so converting a fiche with typed changes lost them
  and carried the old dates or party. While the fiche has unsaved changes the action is disabled with « Enregistrer
  d'abord les modifications. » (the tooltip on a wider screen, the reason beneath the item in the phone's « Plus
  d'actions » menu). +4 client tests.
