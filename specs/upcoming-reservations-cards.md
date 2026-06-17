# « Réservations à venir » — Planning cards grouped by day

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/upcoming-reservations-cards` |
| **Created** | 2026-06-17 |
| **Author** | Adrien |
| **Touches** | `pages/ReservationsUpcomingPage.js` |

---

## 1. Context

The dashboard « Réservations (30j) » card opens `/reservations/upcoming`
([ReservationsUpcomingPage.js](../client/src/pages/ReservationsUpcomingPage.js)), which was a plain
table (Arrivée / Départ / Heures / Logement / Client / Plateforme / Total). Adrien wants it refactored
to the **Planning arrival cards**, consistent with the Planning and with the Finance « Réservations à
venir » section (#220).

Decisions (AskUserQuestion 2026-06-17): **Planning cards (`ReservationCard`) grouped by day**, over
**ALL future reservations** (arrival ≥ today, no 30-day cap).

## 2. Goal

Render the upcoming reservations as the exact Planning arrival cards, grouped under a day header, with
the same actions (open fiche, arrival SAS, open client, toggle « prêt »).

## 3. Functional rules
1. Source = **all reservations whose `startDate ≥ today`** (no upper bound). The list endpoint is queried
   with a far `to`; the client keeps arrivals `startDate ≥ today`.
2. Each reservation's **full detail** is fetched (`api.getReservation`, same as the Planning) so the card
   shows beds / famille / options / ressources / complément / caution / bed-linen alert.
3. Grouped by **arrival day**; each day shows a header (French weekday + a `prêt` count chip, highlighted
   when today / all-ready), then the `ReservationCard`s sorted by check-in time.
4. Card actions: row → fiche, arrival SAS (`ReservationSasDialog`), client, toggle « prêt »
   (`checkInReady` via `PATCH /reservations/:id/payment`). The SAS `onCommitted` reloads the page.
5. Empty state when there is no future reservation.

## 4. Architecture
| Layer | File | Responsibility |
|---|---|---|
| pages | `pages/ReservationsUpcomingPage.js` | Fetch the list (far `to`) → filter `startDate ≥ today` → fetch each detail → group by day → render `ReservationCard` + `ReservationSasDialog`. Render-only; reuses the Planning components. |

No server change (reuses `GET /reservations`, `GET /reservations/:id`, `PATCH /reservations/:id/payment`).

## 5. Out of scope
- The tight-turnover cleaning **alert** badge (the Planning computes it from per-property adjacency;
  omitted here for now — `ReservationCard` renders fine without `alertInfo`).
- Departures / laundry / breakfast cards (this page is arrivals-only).
- Pagination (all future rendered; a window selector can be added later if the list grows large).

## 6. Test plan
- [ ] Manual (dev): the page shows day-grouped Planning cards for all future arrivals; a card opens the
  fiche, the SAS, the client; « prêt » toggles + persists; empty state when none.
