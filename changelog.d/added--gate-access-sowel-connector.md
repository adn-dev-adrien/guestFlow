- **Gate access — the Sowel connector** (spec `gate-access-sowel-connector.md`, 2026-09-20). Guests
  of the gîte and the lodge open the gate from their phone, but **the house is what holds the
  accesses**: Sowel keeps the codes, the hours and the journal, and guestFlow becomes a source of
  stays. It publishes a feed of stays (`/public/v1/gate/stays`, one revision per change) and files
  away the invitation the house hands back (`/public/v1/gate/invitations`) — two outbound calls for
  the house, none inbound for guestFlow. The channel carries a key **distinct** from the WordPress
  site's and a signature whose secret never travels.
- **The code and its QR wherever a guest needs them**: the SAS's « Portail » step shows the code in
  large type and a QR of the address the email carries — flashing it sets the access up with nothing
  to type —, the fiche carries a state card, and the emails have `{{gateAccessCode}}`,
  `{{gateAccessUrl}}` and `{{#if hasGateAccess}}`. All of it comes from the local copy: **composing
  an email never reaches the house and waits for nothing**. +43 server tests, +17 client tests, and
  a signature-contract check run against the real plugin.
