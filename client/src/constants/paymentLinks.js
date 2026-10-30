// specs/payment-link-lifecycle.md rule 50 — the refusal that booked the payment on the server: whoever sent
// the request re-reads the money it shows. The payment routes put the code in `error`.
export const LINK_ALREADY_PAID = 'LINK_ALREADY_PAID';

export const isLinkAlreadyPaid = (err) => Boolean(err) && (err.error === LINK_ALREADY_PAID || err.code === LINK_ALREADY_PAID);
