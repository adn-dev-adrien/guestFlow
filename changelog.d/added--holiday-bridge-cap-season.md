- **A public-holiday raise can now stop below the top season** (spec `tariff-recipes/spec.md` §3.3
  rules 15bis-15ter, 2026-08-25). `public_holiday_bridge` capped its raise at the highest rank a
  recipe declared, which only worked because the Lodge's highest rank *is* its high season. On a
  grid whose top season is a peak-summer price, the same rule sold 25 December at the August rate.
  The modifier now takes an optional `capSeason`; absent, the ceiling stays the highest rank, so
  every existing recipe behaves exactly as before. A cap also never moves a night **down**: a night
  already above it — 14 juillet, 15 août — keeps its price and takes only the block's minimum stay.
  +4 server tests.
