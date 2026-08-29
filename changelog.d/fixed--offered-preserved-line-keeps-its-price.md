- **Offering a check-out line could lose, or overcharge, its price.** The real price of an offered
  end-of-stay line was re-derived as `qty × unitPrice`, which is not always the price. A line whose
  priced item has been renamed or deleted since carries only a label and a total: offered, it was
  stored `1 × 0 €`, so withdrawing the gesture on a re-opened check-out billed **0 €** instead of what
  the guest owed. And a line carried from mid-stay is legitimately stored « 2 × 16,67 € » for 33,33 €,
  so the same reconstruction billed **33,34 €** — a cent too much. The real total is now stored
  verbatim when the gesture is made, and read back as such; quantity and unit price stay what they
  always were, the wording of the line.
