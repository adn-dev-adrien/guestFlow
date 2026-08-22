- **The "update available" offer is now visible in the top bar**
  (specs/self-update-and-releases.md §6.5, rule 20b). Next to the installed version, a bare
  primary-tinted icon announced a published release — and read as chrome, so it went unclicked. It
  becomes a rounded pill: soft fir-green background, update icon, a count, tooltip
  « GuestFlow X.Y.Z est disponible ». Same click, same release notes, same behaviour on « Plus tard »
  and while an update runs. The shape lives in a new generic `HeaderPill` component, so the next
  top-bar indicator does not hand-roll its own. +3 client tests.
