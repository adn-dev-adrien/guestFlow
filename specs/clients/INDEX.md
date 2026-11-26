# Clients — client records, directory, contact input

Start with: `clients` (client MVC, single phone, duplicates, deletion rules). See also: `reservations/`, `emails/`, `accounting/`.

- `clients` — client CRUD in controller and model, one `phone`, duplicate detection, deletion only from the sheet with protected-history refusal, orphan cleanup popup. Code: `server/src/controllers/clientsController.js`, `server/src/models/clientsModel.js`, `client/src/pages/ClientsPage.jsx`.
- `clients-upcoming-past-directory` — directory in three server-bucketed views (À venir, Passés, Sans séjour), stay-date line, single « Trier » select, search across views. Code: `server/src/controllers/clientsController.js`, `client/src/pages/ClientsPage.jsx`, `client/src/constants/clientsDirectory.js`.
- `client-contact-smart-input` — free-text address block and drag-and-drop email or phone parsed by the server (`POST /clients/parse-contact`, `+33` only). Code: `server/src/utils/contactParsing.js`, `client/src/components/ClientFormFields.jsx`.
