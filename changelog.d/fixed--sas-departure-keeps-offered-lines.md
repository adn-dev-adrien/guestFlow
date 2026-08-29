- **A geste commercial made at check-in was billed back at check-out.** `offeredArrivalExtras` is an
  authoritative set: a recalled arrival line absent from it goes back to billed — that is what makes
  un-offering work on a re-open. But the check-out recap only recalls the arrival complement when
  something is still owed on it, and **a complement made entirely of gestes commerciaux is worth
  0 €** — precisely when nothing is rendered. The recap showed no arrival line, sent an empty set
  anyway, and the server read it as « plus rien n'est offert ». On a Gîte stay the « Linge de lit »
  line — a property default offered because the linen is included in the base price — reappeared at
  70 € the moment the departure was validated. The recap now speaks only for the lines it actually
  rendered, and `commitDepartureSas` re-reads the recall condition itself, so no client version can
  reopen the hole. Un-offering at the door is untouched.
