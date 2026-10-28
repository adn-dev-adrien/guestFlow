# Roostview API key — a second, read-only key on the public API

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feat/roostview-api-key` |
| **Created** | 2026-10-25 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Roostview (Adrien's price watch, `adn-dev-adrien/roostview`, spec 004) reads GuestFlow's properties,
blocked nights and nightly prices through the public API (`/public/v1`, [public-api.md](public-api.md)).
That API knows a single key, `PUBLIC_API_KEY`, the WordPress proxy's. Giving Roostview the same key
means one leak or one rotation hits both callers, and Roostview would hold the right to create
booking requests it never needs.

## 2. Goal

Roostview connects with its own key, which can only read; the site's key is untouched.

## 3. Functional rules

1. A second key, `ROOSTVIEW_API_KEY`, is auto-generated at boot into `server/.env.local` like the
   others (never logged), and accepted on `/public/v1` the same ways (`Authorization: Bearer`, `X-API-Key`).
2. It is **read-only**: `GET /properties`, `GET /properties/:id`, `GET /properties/:id/{options,resources,availability}`
   and `POST /quote` (computes, persists nothing). Every other public route answers **403 `FORBIDDEN`**.
3. `PUBLIC_API_KEY` keeps the whole tree, unchanged. Either key can be rotated or removed alone.
4. A Roostview call is its own visitor: the `X-GuestFlow-Visitor-*` headers the proxy relays are
   ignored for it, so the per-visitor rate limiter counts Roostview's own address.
5. Fail closed: an empty or absent `ROOSTVIEW_API_KEY` matches nothing.
6. **Rule 2 is judged on the path under `/public/v1`** (fixed at the 2026-10-27 spec review). Since the
   public chain is mounted once per prefix (`plugins/website-booking/routes/index.js`, plugins phase 2),
   `req.path` is only what follows the prefix (`/`, `/1`): the key matched none of its reads and
   answered 403 on every route. `roostviewMayCall` now rebuilds the path from `req.baseUrl + req.path`
   and strips `/public/v1`.

**Edge cases:**
- Both keys configured to the same value → the call is treated as the site's (full rights); the
  operator should not do this, the boot never generates it.
- Constant time: both comparisons always run, so which key matched does not show in the timing.

---

## 4. Architecture

### Server
| Layer | File | Change |
|---|---|---|
| `middleware/` | `middleware/requirePublicApiKey.js` | Recognises the caller (`site` / `roostview`), sets `req.publicApiCaller`, enforces rule 2 on the full path (rule 6). |
| `middleware/` | `middleware/visitorContext.js` | Rule 4: no relayed visitor for Roostview. |
| entry | `index.js` | `getOrCreateSecret('ROOSTVIEW_API_KEY')` at boot. |

> *On `inte/plugins` (master sync of 2026-10-26):* the public API belongs to the `website-booking`
> plugin. The two middlewares live in `plugins/website-booking/` (`requirePublicApiKey.js`,
> `visitorContext.js`), and the key is created by that plugin's `onInstall` / `onBoot`
> (`sdk.secrets.getOrCreate('ROOSTVIEW_API_KEY', 32)`) next to `PUBLIC_API_KEY`, not by the core boot.

### Client
None.

### API
No new route. `/public/v1/*` answers 403 `FORBIDDEN` to the Roostview key outside rule 2.

## 5. Data model

None. One more line in `server/.env.local`.

## 6. UI / UX

None in GuestFlow. The operator copies `ROOSTVIEW_API_KEY` from `.env.local` into Roostview › Réglages › GuestFlow.

## 7. Test plan

- [x] `tests/require-public-api-key.unit.test.js` — Roostview key reads the catalogue/availability/quote; 403
      on booking requests, terms, plugin update, POST on properties; site key unchanged and told apart;
      fail closed; no relayed visitor for Roostview. **(+5 tests)**
- [x] `plugins/website-booking/tests/roostview-key-mounted.unit.test.js` — rule 6 over HTTP on the REAL
      per-prefix mounts (controllers stubbed): the six reads answer 200 to the Roostview key; booking
      requests, the challenge, terms and a POST on properties answer 403; the site key keeps the tree.
      Failed (403 on every read) before the fix. **(2 tests)**

## 8. Out of scope

- A key table with per-key scopes managed from the admin UI.
- Any write from Roostview.

## 9. Open questions

None.
