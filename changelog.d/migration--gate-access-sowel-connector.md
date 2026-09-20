- Two tables created empty at startup, `gate_stay_feed` and `gate_invitations` (spec
  `gate-access-sowel-connector.md` §5). No column added anywhere else, no backfill, no existing
  record touched.
- Two secrets auto-generated in `server/.env.local` on first boot, `GATE_API_KEY` and
  `GATE_SIGNING_SECRET`, to be copied into Sowel's « Accès invités » plugin. Neither is ever logged
  nor returned by an API.
