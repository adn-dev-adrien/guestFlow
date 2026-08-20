- **GuestFlow updates itself, when you tell it to.** A published version now shows up on the
  dashboard and in Réglages → Système et mises à jour, with its release notes readable in the app.
  One click downloads the archive, checks its SHA-256 against the one published with the release,
  installs the dependencies, verifies that the native database driver loads, takes a WAL-safe backup
  of the database, swaps the deployment and restarts. If the new version does not answer within two
  minutes, the previous one is put back automatically. The browser follows the whole thing on a
  progress overlay and reloads itself when the new version is up. Admins only; nothing is ever
  installed without an explicit click. (specs/self-update-and-releases.md)
