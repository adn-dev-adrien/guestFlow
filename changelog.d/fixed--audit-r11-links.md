- **Payment links — round-11 audit fixes** (spec `payment-link-lifecycle.md` rules 32, 58, 63, 64, readings of
  2026-11-01; `direct-installments.md` rule 50). An installment plan is no longer created or resized beside an
  acompte / solde / séjour link withdrawn for taken dates whose last payment read is still owed; should such a payment
  still land beside a plan, it is never booked on the deposit or balance: it stays on the link as a payment to settle,
  refund only while the plan is there, and the admin is alerted. A new acompte / solde / séjour request reads that link
  first (paid → booked and refused, in flight → refused 409 `LINK_PAYMENT_IN_FLIGHT`). The guest notice fails closed on
  a provider answer without a boolean `pending` (online-payment 1.5.0). A paid installment now withdraws the other
  requests' links on the stay's nights at once. +27 server tests.
