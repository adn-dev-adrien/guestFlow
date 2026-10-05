# Stays in the gate key list — contract v3

| Field | Value |
|---|---|
| **Status** | Implemented (2026-10-05) |
| **Branch** | `feature/gate-keys-stay-block` |
| **Created** | 2026-10-05 |
| **Summary** | `specs/sowel-stays-in-keys-maquettes.html` |
| **Extends** | `gate-access-sowel-connector.md` (contract v2) |
| **Consumers** | Sowel plugin `guestflow` v0.4.0, recipe `heater-cap` (smart heating) |

## Why

Sowel's heating recipe needs each property's occupancy. guestFlow already serves Sowel the list
of gate keys, one per stay, over the signed channel (`GET /public/v1/gate/keys`). We reuse it:
no new endpoint, no new secret, no feed with a cursor (the design #563 dropped).

## Change

Every key, `create` and `revoke`, gains:

```json
"stay": {
  "propertyId": 1,
  "propertyName": "Gîte",
  "arrival": "2026-10-06T16:00:00+02:00",
  "departure": "2026-10-09T10:00:00+02:00"
}
```

- `arrival` = `startDate` + `checkInTime`, `departure` = `endDate` + `checkOutTime`,
  Europe/Paris with offset — the same inputs and fallbacks (15:00 / 10:00) as the gate window
  (`utils/gateWindow.js`, whose check-in / check-out instants are reused), without the −3 h / +2 h.
  `propertyId` is an integer, `propertyName` comes from `properties.name`.
- A deleted reservation has no row left: its `revoke` rebuilds `stay` from `gate_key_results`,
  which gains a `propertyId` column (arrival/departure derive from the stored window: `startsAt`
  + 3 h, `endsAt` − 2 h). The column is filled when the house posts its results, and backfilled at
  start for every row whose reservation still exists.
- `stay` is **optional**: it is left out when the property is not known — a result filed before the
  column existed for a reservation deleted since (nothing left to backfill from), or a property
  that no longer exists. Never sent half-filled.
- Additive only: the v0.3.0 plugin validates `reservationId`, `action`, `label`, `startsAt`,
  `endsAt` and keeps working unchanged.
- The 7-day lead is kept; heating pre-heat needs hours, not days.

## Where it lives

- `server/src/utils/gateWindow.js` — `toParisIso`: an instant as Paris wall clock with its offset.
- `server/src/utils/gateKeys.js` — the `stay` block on `create` and `revoke`.
- `server/src/models/gateKeysModel.js` — `propertyId` read with the stays, stored with the results;
  `migratePropertyId` (column + backfill), run by `database.js` at start.
- `server/src/utils/gateResults.js` — stores the reservation's `propertyId` with each result.
- `server/src/schema.sql` — `gate_key_results.propertyId INTEGER` for fresh databases.

The rule itself is written in `gate-access-sowel-connector.md` §3.1 rule 4b, and the wire contract
there in §4.3 (v3); this file has no numbered rules of its own.

## Tests

`server/src/tests/gate-keys-stay.unit.test.js`: payload shape for `create` and `revoke`, per-stay
check-in/check-out times honoured (and their fallback), DST boundary (a stay across 2026-10-25),
deleted reservation rebuilt from the results table, old row without `propertyId` → no `stay`, the
migration and its backfill. The existing `create` shape assertion in `gate-keys-list.unit.test.js`
gains the block.
