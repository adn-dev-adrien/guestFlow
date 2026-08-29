- **Offering a « préservée » check-out line lost its price.** A line whose priced item has been renamed
  or deleted since carries only a label and a total, no unit price. Offered at the door it was stored
  as `1 × 0 €`, so the real price was gone: a re-opened check-out recap showed 0 €, and withdrawing the
  gesture billed 0 € instead of what the guest owed — against the rule that offering is lossless and
  reversible. The server now keeps the price recoverable as `qty × unitPrice`, collapsing such a line
  to `1 × <its real total>` instead of storing a zero, and the re-open reads it back the way it already
  reads a carried arrival line.
