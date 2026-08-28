- **Applying a tariff recipe is idempotent again when a season label carries an internal capital**
  (spec `tariff-recipes/spec.md` §3.2 rule 11bis, 2026-08-25). Season labels were run through the
  same sentence-casing that tidies what an operator types into the season dialog, so a recipe
  declaring « Nouvel An » stored « Nouvel an » — and the next preview saw a label change it could
  never satisfy. Every apply, including the monthly horizon check, rewrote every season and stamped
  a line in the tariff-change journal, which is exactly the data a tariff change is measured
  against. A label declared by a recipe now keeps its casing; a label typed by the operator is still
  tidied. Found while applying the Gîte's recipe; no shipped recipe was affected before it, the
  Lodge's labels being sentence-case already. +2 server tests.
