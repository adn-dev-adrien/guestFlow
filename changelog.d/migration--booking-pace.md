- New table `booking_pace_cancellations` (written when an iCal cancellation is approved, so the
  deleted stay keeps counting on the dates it was booked) and index `idx_reservations_createdAt`.
  Additive; no existing row changes.
