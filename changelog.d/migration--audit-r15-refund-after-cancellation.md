- **`reservation_refunds.afterCancellation`** (INTEGER, nullable) — added by an idempotent `ALTER TABLE` at boot. A new
  refund records 1 when its stay was already cancelled, 0 otherwise; existing rows stay NULL and keep reading their
  `createdAt` against the stay's `cancelledAt`. No backfill, no existing row rewritten.
