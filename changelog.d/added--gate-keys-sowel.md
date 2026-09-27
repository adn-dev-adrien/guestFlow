- **Gate keys for Sowel** (spec `gate-access-sowel-connector.md`, 2026-09-27). Sowel's `guestflow`
  plugin reads `GET /public/v1/gate/keys` every hour — the keys to create (live stays arriving within
  7 days, or already holding a key) and to revoke (cancelled or deleted stays that may still hold
  one) — and posts every outcome back to `POST /public/v1/gate/results`. guestFlow opens nothing
  towards the house; the channel carries a key distinct from the WordPress site's and an HMAC
  signature whose secret never travels, and guestFlow signs every answer
  (`X-Gate-Response-Signature`) so a server posing as guestFlow cannot make Sowel create keys. A key
  opens 3 h before check-in and closes 2 h after check-out. Supersedes the stay feed of PR #563,
  which was never merged.
- **The code and its QR wherever a guest needs them**: the SAS « Portail » step shows the code and a
  QR of the link the email carries, the fiche has a read-only « Accès portail » card, and the email
  editor gains `{{gateAccessCode}}`, `{{gateAccessUrl}}` and `{{#if hasGateAccess}}` — all read from
  the stored result, so composing an email never waits on the house.
- **Admins are warned when a key cannot be made**: a « Clés portail » dashboard alert lists the
  failing reservations with the reason, and every admin receives one Web Push per reservation and
  error (« Clé portail non créée — R-2026-041 · Marie — le profil par défaut n'est pas accordé au
  plugin »). The same alert and one push fire when Sowel has not read the list for more than 3 hours.
- Réglages → Intégrations: an « Accès portail (Sowel) » card with the last read (« Sowel ne lit
  plus » past 3 h), the keys created, and — for admins — the three values to paste into the plugin
  (guestFlow's address, `GATE_API_KEY`, `GATE_SIGNING_SECRET`), the secrets masked behind
  « Afficher », each with « Copier ».
