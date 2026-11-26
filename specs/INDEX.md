# Specs — index

Find a spec in two reads: pick the domain below, open its `INDEX.md` (one line per spec: what it governs,
its key code paths), then open only the spec you need. A spec's name is unique across `specs/`, so
`find specs -name '<name>.md'` or `grep -n '<name>' specs/*/INDEX.md` also works. Method and conventions:
[README.md](README.md).

- [accounting/](accounting/INDEX.md) — journal export, VAT, bank reconciliation (Qonto, Mollie), Suivi financier, fiscal year, stay profile. Keywords: compta, export comptable, TVA, rapprochement, encaissé, exercice, RevPAR.
- [clients/](clients/INDEX.md) — client records, directory, contact input. Keywords: fiche client, annuaire, téléphone, e-mail.
- [design-system/](design-system/INDEX.md) — « Maison » tokens and components, page patterns, report grammar, UI review rules (root `DESIGN.md` is the live reference). Keywords: thème, composants, onglets, revue UI.
- [devis/](devis/INDEX.md) — quotes stored as reservations (`kind='devis'`), conversion, PDF. Keywords: devis, PDF, accepter, anglais.
- [emails/](emails/INDEX.md) — templates, guest sequence (J-7, J-2, J-1), sending policy (never automatic without approval), history, language. Keywords: mail, modèle, relance, envoi manuel.
- [gift-vouchers/](gift-vouchers/INDEX.md) — the gift-voucher plugin: amount and bath vouchers, campaigns, sale, code, redemption. Keywords: bon cadeau, campagne, code.
- [guest-app/](guest-app/INDEX.md) — « Mon séjour » guest app (booklet, gate, shop, bath, smart home), Sowel connector, weather alerts, push. Keywords: livret, portail, boutique, domotique, PWA.
- [hosting/](hosting/INDEX.md) — releases and self-update, security, accounts, control plane and fleet, backup, timezone. Keywords: release, mise à jour, 2FA, chiffrement, sauvegarde.
- [linen/](linen/INDEX.md) — bed and bath linen counts, laundry trips, stock and shortages (plugin `linen`). Keywords: linge, laverie, draps, serviettes.
- [options/](options/INDEX.md) — option catalogue, per-property scope, prices and defaults, planning-card options (breakfast, meals, baby bed). Keywords: option, petit-déjeuner, lit bébé, catégorie.
- [payments/](payments/INDEX.md) — how a stay is paid, collected, refunded, cancelled: ledger, schedule, deposits, payment links, refunds. Keywords: acompte, solde, caution, lien de paiement, Qonto, remboursement, annulation.
- [planning/](planning/INDEX.md) — home day lists, planning timeline, calendars, dashboard alerts, cash view. Keywords: accueil, planning, calendrier, tableau de bord.
- [platforms/](platforms/INDEX.md) — OTA channels (Airbnb, Booking, Gîtes de France), platform money, iCal import and export. Keywords: plateforme, commission, versement, iCal, Lodgify.
- [plugins/](plugins/INDEX.md) — plugin engine (SDK, hosts, registry, provisioning, removal) and plugin boundaries. Keywords: plugin, module, SDK, registre.
- [pricing/](pricing/INDEX.md) — nightly price engine and pricing components, seasons, tariff recipes, closures, school holidays. Keywords: tarif, saison, recette tarifaire, dégressivité, nuits minimum.
- [reservations/](reservations/INDEX.md) — the reservation fiche: saving, locks, capacity, history, numbers, terms acceptance. Keywords: fiche, enregistrer, verrou, historique, CGV.
- [resources/](resources/INDEX.md) — bookable hourly resources (bain nordique): sessions, pricing, invoicing, SAS scheduling. Keywords: bain, séance, heure, ressource.
- [sas/](sas/INDEX.md) — arrival and departure wizard (SAS) and the complements it collects. Keywords: arrivée, départ, complément, check-in, réception.
- [settings/](settings/INDEX.md) — Paramètres pages (Établissement, Plateformes, E-mails, Paiements, Google Calendar) and their input rules. Keywords: réglages, paramètres, webhook.
- [site/](site/INDEX.md) — public website: `/public/v1` API, WordPress plugin and booking drawer, online payment, site content, analytics. Keywords: site, WordPress, réservation en ligne, tiroir.
- [tech/](tech/INDEX.md) — build and test tooling, schema baseline, spec coverage tooling, code structure, performance. Keywords: tests, E2E, Vite, migration, couverture des règles.
- [tourist-tax/](tourist-tax/INDEX.md) — tourist tax: calculation base, platform handling, freeze, declaration, report. Keywords: taxe de séjour, déclaration, reversement.
