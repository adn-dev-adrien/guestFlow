- **Control plane — the operator console (C2a)** (`specs/control-plane-plans-and-access.md`). A new
  app in `control-plane/`, deployed separately from GuestFlow and inert for self-hosted installs:
  the plan catalogue (Essentiel / Pro / Premium, nested, versioned, with the impact of a change
  shown before saving), the customers with their creation steps, the fleet and its alerts, the
  signed licence written to each instance, the subscription lifecycle recomputed daily (a payment
  recorded by hand, extensions and « Remettre en actif » with a reason), and deprovisioning with a
  full export. Operators log in with a password and a second factor of their choice: an
  authenticator app or a code by email, with backup codes. The Qonto invoices and reminders come
  with C2b.
- **Instance: `server/scripts/create-first-admin.js`**, which the console runs to create a hosted
  customer's first administrator (and close the unused bootstrap account).
