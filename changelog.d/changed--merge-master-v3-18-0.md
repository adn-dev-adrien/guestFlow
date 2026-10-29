- **Master v3.17.0–v3.18.0 merged into `inte/plugins`** (2026-10-27): the Airbnb checkout-chores rules
  (spec `airbnb-no-checkout-chores.md`) and the platform cleaning fee of the tariff recipes (spec
  `tariff-recipe-platform-cleaning-fee.md`). No channel is recognised by its name any more: the chores
  rules read a platform setting, « Sans corvées de départ » (`platforms.forbidsGuestChores`, Paramètres ›
  Plateformes), and the cleaning-fee computation moved into the `tariff-recipes` plugin. Plugins `sas`
  1.6.0 and `tariff-recipes` 1.3.0.
- plugin:sas On a « Sans corvées de départ » platform, the SAS no longer reminds about the dishes or the bins, and cleaning not done is no longer billed at departure.
- plugin:tariff-recipes A recipe can declare the cleaning fee a platform charges; the application preview reports it.
