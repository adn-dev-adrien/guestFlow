- **The fiche can now move the arrival complement to check-out, and set what any complement is worth**
  (specs/defer-arrival-complement-to-checkout.md §3.3 + specs/adjustable-complement-amounts.md). The
  arrival complement card gains a « Percevoir en fin de séjour » switch — an explicit operator
  decision, nothing flips it on its own — writing the same marker the arrival SAS recap writes, so
  the choice no longer has to wait for check-in. Once it is on, the fiche merges the two cards, the
  summary panel files the money under « fin de séjour », the day-of-operations views drop the arrival
  alert, and the J-2 / J-1 emails announce « à votre départ » instead of « à votre arrivée ». It is
  reversible until the guest is in; from the arrival day it shows on and locked, because an
  uncollected complement is taken at the door whatever the marker says.
- **Every complement carries an adjustable amount** (specs/adjustable-complement-amounts.md §3). A
  complement is announced to the guest before it is collected, and the announced amount is the one
  that changes hands — so the arrival complement, the end-of-stay complement and each settled
  mid-stay note can be frozen at what was said, **including after collection**, which used to need a
  hand-written SQL statement in production. An empty field hands the bucket back to the engine.
  The arrival SAS no longer overwrites an adjusted amount when it commits.
