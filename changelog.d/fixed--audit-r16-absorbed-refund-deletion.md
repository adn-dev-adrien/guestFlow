- **Cancelled stay — a refund the paid solde absorbed can be deleted again** (spec
  `payment-schedule-and-cancellation.md` rule 55, reading of 2026-11-02, audit R16-L1). A book refund made before the
  cancellation is refused deletion (409 `REFUND_NETTED_BY_CANCELLATION`) only when it moved the `retained` avoir: the
  requalification is rebuilt without it and compared with the avoir. A refund the paid solde absorbed whole is now
  deleted by the API and offered « Supprimer » on the fiche; the avoir and the indemnity do not move. +4 server tests.
