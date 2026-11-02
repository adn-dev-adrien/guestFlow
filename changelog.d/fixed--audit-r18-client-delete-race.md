- **Clients — a late answer no longer swaps the client in the delete confirmation** (audit R18-C1,
  `specs/clients.md` rule 17). When the impact of a client the operator had just left arrived after the
  confirmation of another client had opened, the dialog showed the first client's name, stays and
  blocker while « Confirmer la suppression » deleted the second. The confirmation and the sheet's stay
  list now show only the answer of their latest request; a deletion that ends after the operator moved on
  no longer closes or marks the next confirmation.
