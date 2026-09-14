- **`portier_outbox`** (new table), and a one-time backfill (`portier_outbox_backfill_v1`) of every
  reservation whose stay has not ended, plus the company logo. The rows leave at the first boot where
  `PORTIER_SVC_URL` and `PORTIER_KEY_GF` are set (see README); without them nothing is sent and
  guestFlow runs normally.
- **`email_log` is rebuilt once** to accept the statuses `waiting_portier` and `skipped`, with the
  columns `nextAttemptAt`, `waitingSince` and `adminNotifiedAt`. Every row is carried over with its id.
- **One-shot `gate_access_paragraph_v1`**: the gate paragraph (link and code) is inserted into the
  J-7 and J-2 templates an instance already holds, above their sign-off, without rewriting a character.
