- **Devis — dated and expired on the operator's day** (specs `devis-pdf-and-tourist-tax-fixes.md` rule 23,
  `devis-extras-parity-and-price-lock.md` rule 21, audit R8-1, 2026-10-30). Between 00:00 and 01:00 /
  02:00 in Paris the devis model still read the UTC date: a devis created then carried one day less than
  the configured validity and its PDF printed the previous « Date du devis », and a devis expired the day
  before kept its frozen prices and could not be extended. The model and the PDF now read the local day,
  like the rest of the server; `createdAt` stays a UTC timestamp. +10 server tests.
