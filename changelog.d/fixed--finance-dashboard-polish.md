- **Suivi financier — visual finish** (spec `finance-dashboard-redesign.md` rules 30-32, 2026-09-29). Cards and
  tiles back to the design system's 14 px radius (a numeric `sx` radius was multiplied by the theme's 14:
  49 px tiles, a 63 px banner); the revenue banner is ink with honey accents, flat, its four figures in a
  hairline grid; the cumulative curve is graduated on the 1st of each month (weekly on a « Mois » window)
  instead of on its weekly points. `hero.axis` and `cumulative[].x` added to `/api/finance/dashboard`.
  +5 server tests.
