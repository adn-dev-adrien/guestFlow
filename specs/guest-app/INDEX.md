# Guest app — « Mon séjour » (booklet, gate, shop, bath, smart home), Sowel gate/home connector, weather alerts, staff push

Start with: `guest-app` (the app's rules 1-113, architecture and API). See also: `plugins/`, `sas/`, `hosting/`.

- `guest-app` — the guest PWA and its Studio: one link per stay, home, booklet, in-stay shop and card orders priced by the fiche's engine, service hours, stock, staff orders page. Code: `server/src/plugins/guest-app/index.js`, `server/src/plugins/guest-app/apps/guest`, `server/src/plugins/guest-app/apps/studio`.
- `guest-app-bath-home-scheduling` — home card to schedule the nordic bath, owned and extra hours, consecutive blocks, price always from the server quote. Code: `server/src/plugins/guest-app/bathPlan.js`, `server/src/plugins/guest-app/controllers/shopController.js`.
- `guest-app-home-automation` — « Domotique » page fed by Sowel: shared sensors, temperatures, rain, energy, guest-switchable lights, Studio selection per lodging. Code: `server/src/plugins/guest-app/homeView.js`, `server/src/plugins/gate-access/homeRoutes.js`.
- `gate-access-sowel-connector` — Sowel pulls the list of gate keys (create/revoke, `stay` block) and posts outcomes; signed responses, alerts, SAS and fiche display. GuestFlow never calls the house. Code: `server/src/plugins/gate-access/keys.js`, `server/src/plugins/gate-access/index.js`.
- `checkin-weather-alerts` — Météo-France vigilance alerts for the arrival window, shown as a SAS step; département geocoded from the company address. Code: `server/src/plugins/weather-alerts/index.js`.
- `pwa-push-notifications` — Web Push for staff devices: per-device opt-in, per-user per-channel preferences, new reservation, arrivals, departures, VAPID, bounded sends. Code: `server/src/utils/pushService.js`, `server/src/utils/pushChannels.js`.
- `guest-app-local-amenities` — « Pratique » page: shops, services and waste points around the estate on a map, category filters, open state, GPS links, places entered in the Studio. Code: `server/src/plugins/guest-app/places.js`, `server/src/plugins/guest-app/controllers/placesController.js`. **[Draft]**
