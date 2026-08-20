- **The quote now says what the payment buys.** On a direct-channel quote, the « Acompte » row carries
  the sentence the deposit-request email already used — *« Le règlement de l'acompte bloque vos dates :
  tant qu'il n'est pas payé, elles restent disponibles et peuvent être réservées par un autre client »*
  — in French and in English. A guest used to read a deadline without ever being told what it was for.
  Platform quotes are untouched: there, the platform holds the dates. (specs/deposit-blocks-the-dates.md)
- **Full-payment requests.** A new email template « Demande de paiement intégral (lien de paiement) »
  (FR/EN), and the devis action renamed « Envoyer la demande de paiement »: the server decides what to
  ask for — the acompte when there is one, the whole stay otherwise — and the email quotes, to the cent,
  what the Qonto link charges. A last-minute quote used to hit a dead end there, since asking for a 0 €
  acompte is refused. (specs/deposit-blocks-the-dates.md)
