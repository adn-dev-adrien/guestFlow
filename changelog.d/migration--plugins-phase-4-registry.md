- **`plugins` table** (spec `plugins-phase-4-registry.md` §5): `+ manifest`, `+ pinned_sha256`,
  `+ previous_version`, `+ previous_source`, `+ previous_sha256`, `+ rollback_until`; the existing
  `builtin` rows become `bundled` and take the version of the copy the release ships. Nothing else
  changes: every plugin stays installed and active as it was, with its data.
