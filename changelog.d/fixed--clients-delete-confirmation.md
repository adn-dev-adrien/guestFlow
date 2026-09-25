- **Clients — the deletion confirmation closes when asked** (spec `clients.md` §3 rule 10, 2026-09-25).
  « Annuler » left the dialog on screen, and « Confirmer la suppression » brought it straight back on a
  client the server no longer had — « Client non trouvé », as if the deletion had already happened. The
  `?deleteClientId=` watch effect was re-opening the dialog it had just closed, one render before React
  Router flushed the URL. +6 client tests.
