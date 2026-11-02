- **Clients — a deletion that fails after the operator moved on is reported** (`specs/clients.md`
  rule 18). A forced deletion failing once its confirmation was closed, or replaced by another
  client's, now shows an error toast instead of failing silently. Closing « Nettoyer les clients »
  while its list loads no longer lets the late answer reopen the popup.
