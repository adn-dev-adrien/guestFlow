# Linen — bed/bath linen counts, laundry trips, stock and shortage projection (plugin `linen`)

Start with: `weekly-bed-linen-tracking` (laundry window maths, linen options, property defaults). See also: `options/`, `sas/`, `planning/`.

- `weekly-bed-linen-tracking` — Weekly laundry aggregation from bed counts and linen options (« À apporter » / « À récupérer »), linen option flags, property defaults. Code: `server/src/plugins/linen/laundryModel.js`, `server/src/plugins/linen/laundryWindow.js`, `client/src/plugins/linen/LaundryDayCard.jsx`.
- `bed-config-in-linen-card` — Bed counts (single/double/baby) live inside the « Linge de lit » option card, not the guests card; zeroed when no bed linen. Code: `client/src/components/reservation/ExtrasSection.jsx`, `client/src/components/reservation/GuestsBedsSection.jsx`.
- `linen-inventory-shortage-tracking` — Stock per linen type, clean-stock projection after each drop-off, first-shortage alert. Code: `server/src/plugins/linen/linenInventory.js`, `server/src/plugins/linen/shortageController.js`, `client/src/plugins/linen/LinenStockPage.jsx`.
- `laundry-counts-explicit-option-only` — Laundry counts follow the option ticked on the reservation, not the property default; incomplete reservations listed with a warning chip. Code: `server/src/plugins/linen/laundryModel.js`.
- `laundry-bath-mat` — Bath mat as a seventh laundry linen type with its own option, stock and counts. Code: `server/src/utils/bathMatSeed.js`, `server/src/plugins/linen/linenInventory.js`.
- `linen-laundry-days` — Several laundry days per week plus a laundry turnaround, versioned schedule; amends the single-weekday rules. Code: `server/src/plugins/linen/laundrySchedule.js`, `server/src/plugins/linen/laundryScheduleModel.js`, `client/src/plugins/linen/LaundryScheduleSection.jsx`.
- `skip-laundry-trip` — A trip can be marked not made; its batches defer to the next trip. Code: `server/src/plugins/linen/skipsModel.js`, `server/src/plugins/linen/skipsController.js`.
- `manual-laundry-additions` — Manual linen added to a trip (not tied to a reservation), counted in drop-off, pick-up and projection. Code: `server/src/plugins/linen/manualAdditionsModel.js`, `client/src/plugins/linen/LaundryManualAdditionsDialog.jsx`.
- `laundry-manual-removals` — Linen washed by the host can be removed from a trip's counts (negative manual entries). Code: `server/src/plugins/linen/manualAdditionsModel.js`.
- `laundry-extra-trip` — Extra early laundry trip on a free date, with its own batches. Code: `server/src/plugins/linen/extraTripsModel.js`, `client/src/plugins/linen/LaundryExtraTripDialog.jsx`.
- `sas-bath-linen-upsell` — Arrival SAS offers bath linen (per person) when not booked and adds it as a fiche option; payment is settled at the recap, never deferred as a parallel end-of-stay line. Code: `server/src/plugins/sas/controller.js`, `server/src/models/reservationsModel.js`.
- `sas-bath-linen-ghost-line` — The SAS never writes a parallel end-of-stay bath-linen line (it double-billed « Linge de toilette »); legacy ghost lines dropped at commit and boot. Code: `server/src/utils/bathLinenGhostLine.js`.
