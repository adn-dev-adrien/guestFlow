- **The update dialog now shows every version between the one installed and the one on offer**
  (specs/self-update-and-releases.md rules 12b + 20d). It used to show the release notes of the
  target and nothing else, which told the whole story only when no release had been skipped — an
  operator who postponed once, or whose host was offline for a day, jumped 2.1.0 → 2.3.0 and was
  never told, anywhere in the application, what 2.2.0 changed. The hourly check now reads the
  release *list* instead of `/releases/latest` (same single HTTP call) and the dialog lists each
  version's digest under its own heading, with a « 3 versions depuis la 2.0.0 » caption and every
  version's full changelog behind the existing toggle. A single-version update looks exactly as it
  did. The target is still chosen exactly as before — newest published release, archive and
  `SHA256SUMS` included — so a broken publish still offers nothing rather than falling back to an
  older version. +10 server tests, +5 client tests.
