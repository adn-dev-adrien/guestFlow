- Two tables created empty at startup, `gate_key_results` and `gate_connector_state` (spec
  `gate-access-sowel-connector.md` §5). No column added anywhere else, no backfill, no existing
  record touched.
- Two secrets auto-generated in `server/.env.local` on first boot, `GATE_API_KEY` and
  `GATE_SIGNING_SECRET`, to be copied into Sowel's `guestflow` plugin — Réglages → Intégrations shows
  them to admins. Neither is ever logged.
