- **Gate access through Portier** (`specs/gate-access-portier.md`): every stay is pushed to Portier —
  the program that keeps the gate accesses — the moment the reservation exists (form, accepted devis,
  online payment, iCal import), and again when its dates, times or lodging change; a cancellation or a
  deletion revokes it. Pushes are written to an outbox in the same transaction as the reservation
  change and retried with a back-off while Portier does not answer; one failing for more than an hour
  shows on the fiche and on the list.
- **Réglages › Accès portail** (admin only): every access, stays and hand-made ones, with the house
  line, the validity in words, the hours, the phones and the last use; creation and editing with the
  refusals shown while typing; suspend and resume, « Nouvelle invitation », « Régénérer l'accès »,
  delete, the journal; and the tab « Application des clients » for the logo of the guests' app.
- **SAS step « Accès portail »**: the stay's code and a QR of its invitation link — flashing it sets
  the guest's app up. When Portier does not answer: « Accès portail indisponible », « Réessayer », and
  the gate keypad's code.
- **Fiche card « Accès portail »**: state, window in force, phones, last use, « Ouvrir dans la liste »,
  and « Recréer » for an access deleted in the list.
- **The J-7 and J-2 reminders carry the invitation link and code**, read from Portier when the email
  is composed. When Portier does not answer, the email waits — « En attente de Portier · prochain essai
  à HH:MM » in the history — and is retried after 1, 2, 5 and 15 minutes, then every 15 minutes; the
  admins are notified once after an hour. A manual « Envoyer » is queued the same way and says so.
- **A push notification to the admins when a seventh phone is set up on one access**
  (Portier's `devices_over_six` event).
