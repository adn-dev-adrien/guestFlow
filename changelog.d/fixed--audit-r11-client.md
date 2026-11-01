- **« Dates prises » and « Ouvrir » no longer drop a draft** (audit R11, spec `payment-link-lifecycle.md` rules 39, 46,
  48, readings of 2026-11-01). The « Dates prises » chip of the fiche's action bar leaves through the unsaved-changes
  guard, like a sidebar link: a dirty devis or reservation asks before it is left instead of reloading the form over
  the draft. An in-place « Ouvrir » inside an app dialog (the iCal drift approval, the « Devis non enregistré »
  refusal on a phone) closes that dialog first, as « Annuler » would, and goes through the same guard, so « Approuver
  quand même » is never left over another page. A save that keeps the fiche open shows the fresh marker: a devis moved
  onto free nights loses « Dates prises » at once. +10 client tests.
