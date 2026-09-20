- **The stay feed is computed on read**, without hooking a single write path: a creation, a date
  change, a cancellation, a deletion, a hand-made fix in the database or a restore from backup are
  all seen the same way. A « forgotten hook » is therefore impossible, and a deployment has nothing
  to backfill.
