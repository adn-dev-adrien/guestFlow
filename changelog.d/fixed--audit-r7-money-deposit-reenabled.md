- **An acompte link paid after the stay was switched to « Sans acompte » no longer loses the money.** When the
  Qonto deactivation failed or the guest paid in between, the payment was booked as a paid acompte the fiche hid,
  and the next save erased it from the stay and from the journal. The booking now re-enables the acompte
  (history « Acompte réactivé : payé par un lien retiré »), lowers the solde by as much, and the admin alert says
  so. Audit R7 M1 (`specs/disable-deposit-per-reservation.md` rule 12, `specs/plugins-phase-3a-online-payment.md`
  rule 48).
